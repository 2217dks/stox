const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { resolveHoldingPrice } = require("./portfolioValuationService");
const { AppError } = require("../utils/errors");
const logger = require("../utils/logger");
const {
  createNotificationEvent,
  enqueueNotificationEvent,
} = require("./notificationEventService");

const ZERO = new Prisma.Decimal(0);

/**
 * Determine effective league status dynamically based on current UTC time and configured bounds.
 */
function getEffectiveLeagueStatus(league, now = new Date()) {
  if (league.status === "CANCELLED") {
    return "CANCELLED";
  }
  const currentDate = now instanceof Date ? now : new Date(now);
  const start = new Date(league.startDate);
  const end = new Date(league.endDate);

  if (currentDate < start) {
    return "UPCOMING";
  }
  if (currentDate >= end) {
    return "COMPLETED";
  }
  return "ACTIVE";
}

/**
 * Synchronize league statuses in database based on current UTC time.
 */
async function syncLeagueStatuses(now = new Date(), client = prisma) {
  const currentDate = now instanceof Date ? now : new Date(now);

  // Transition UPCOMING -> ACTIVE once startDate arrives
  if (client.league && typeof client.league.updateMany === "function") {
    await client.league.updateMany({
      where: {
        status: "UPCOMING",
        startDate: { lte: currentDate },
        endDate: { gt: currentDate },
      },
      data: { status: "ACTIVE" },
    });
  }

  // Process completed leagues and reconciliations
  await processCompletedLeagues({ now: currentDate, client });
}

/**
 * Create a new trading competition/league.
 */
async function createLeague({
  name,
  description,
  startingBalance = 10000,
  startDate,
  endDate,
  maxParticipants,
}) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start >= end) {
    throw new AppError("endDate must be after startDate.", {
      statusCode: 400,
      code: "INVALID_DATE_RANGE",
    });
  }

  const now = new Date();
  const status = getEffectiveLeagueStatus({ startDate: start, endDate: end, status: "UPCOMING" }, now);

  const league = await prisma.league.create({
    data: {
      name,
      description: description || null,
      startingBalance: new Prisma.Decimal(startingBalance),
      maxParticipants: maxParticipants ? Number(maxParticipants) : null,
      startDate: start,
      endDate: end,
      status,
    },
  });

  return league;
}

/**
 * List leagues with pagination and optional status filter.
 */
async function listLeagues({ status, page = 1, limit = 20, now = new Date() } = {}) {
  await syncLeagueStatuses(now);

  const where = {};
  if (status) {
    where.status = status;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [leagues, total] = await Promise.all([
    prisma.league.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { startDate: "desc" },
      include: {
        _count: {
          select: { members: true },
        },
      },
    }),
    prisma.league.count({ where }),
  ]);

  return {
    data: leagues.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      startingBalance: Number(l.startingBalance),
      maxParticipants: l.maxParticipants,
      startDate: l.startDate,
      endDate: l.endDate,
      status: getEffectiveLeagueStatus(l, now),
      memberCount: l._count.members,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Get single league by ID.
 */
async function getLeagueById(id, now = new Date()) {
  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  if (!league) {
    throw new AppError("League not found.", {
      statusCode: 404,
      code: "LEAGUE_NOT_FOUND",
    });
  }

  const effectiveStatus = getEffectiveLeagueStatus(league, now);
  if (league.status !== effectiveStatus) {
    await prisma.league.update({
      where: { id: league.id },
      data: { status: effectiveStatus },
    });
    league.status = effectiveStatus;
  }

  return {
    id: league.id,
    name: league.name,
    description: league.description,
    startingBalance: Number(league.startingBalance),
    maxParticipants: league.maxParticipants,
    startDate: league.startDate,
    endDate: league.endDate,
    status: league.status,
    memberCount: league._count.members,
    createdAt: league.createdAt,
    updatedAt: league.updatedAt,
  };
}

/**
 * Join a league.
 *
 * Rules:
 * - Every participant must use a fresh, dedicated league portfolio funded with exactly startingBalance.
 * - Existing portfolios cannot be submitted (400 EXISTING_PORTFOLIO_NOT_ALLOWED).
 * - Late joining after startDate is strictly disallowed (400 LEAGUE_ALREADY_STARTED).
 * - League status must be UPCOMING and now < startDate.
 * - Atomic capacity enforcement via row lock prevents race conditions on maxParticipants.
 * - Duplicate join is rejected atomically (409 ALREADY_JOINED) without leaving orphan portfolios.
 */
async function joinLeague({ leagueId, userId, portfolioId, now = new Date() }) {
  if (portfolioId) {
    throw new AppError(
      "Existing portfolios are not permitted for leagues. A dedicated league portfolio is automatically allocated.",
      {
        statusCode: 400,
        code: "EXISTING_PORTFOLIO_NOT_ALLOWED",
      },
    );
  }

  const currentDate = now instanceof Date ? now : new Date(now);

  const member = await prisma.$transaction(async (tx) => {
    // 1. Lock the League row FOR UPDATE to atomically serialize join capacity checks
    const leagues = await tx.$queryRaw`
      SELECT id, name, "startingBalance", "maxParticipants", "startDate", "endDate", status
      FROM "League"
      WHERE id = ${leagueId}
      FOR UPDATE
    `;

    const league = leagues[0];
    if (!league) {
      throw new AppError("League not found.", {
        statusCode: 404,
        code: "LEAGUE_NOT_FOUND",
      });
    }

    const effectiveStatus = getEffectiveLeagueStatus(league, currentDate);
    if (league.status !== effectiveStatus) {
      await tx.league.update({
        where: { id: league.id },
        data: { status: effectiveStatus },
      });
      league.status = effectiveStatus;
    }

    // 2. Late joining disallowed: joinedAt <= startDate required; joining requires status UPCOMING and now < startDate
    const startDate = new Date(league.startDate);
    if (currentDate >= startDate || effectiveStatus !== "UPCOMING") {
      throw new AppError("Cannot join league after it has started.", {
        statusCode: 400,
        code: "LEAGUE_ALREADY_STARTED",
      });
    }

    // 3. Atomically enforce member capacity
    if (league.maxParticipants !== null && league.maxParticipants !== undefined) {
      const currentMemberCount = await tx.leagueMember.count({
        where: { leagueId },
      });
      if (currentMemberCount >= Number(league.maxParticipants)) {
        throw new AppError("League is full.", {
          statusCode: 400,
          code: "LEAGUE_FULL",
        });
      }
    }

    // 4. Duplicate join check
    const existingMember = await tx.leagueMember.findUnique({
      where: {
        leagueId_userId: {
          leagueId,
          userId,
        },
      },
    });

    if (existingMember) {
      throw new AppError("User is already a member of this league.", {
        statusCode: 409,
        code: "ALREADY_JOINED",
      });
    }

    // 5. Create fresh, dedicated league portfolio funded with exactly startingBalance
    const startingBalance = new Prisma.Decimal(league.startingBalance);
    const newPortfolio = await tx.portfolio.create({
      data: {
        userId,
        name: `${league.name} - ${Date.now()}`,
        description: `Competition portfolio for ${league.name}`,
        startingBalance,
        cashBalance: startingBalance,
        reservedCash: ZERO,
        isDefault: false,
        isActive: true,
      },
    });

    // 6. Create league member
    const newMember = await tx.leagueMember.create({
      data: {
        leagueId,
        userId,
        portfolioId: newPortfolio.id,
        joinedAt: currentDate,
      },
      include: {
        portfolio: true,
      },
    });

    return newMember;
  });

  return member;
}

/**
 * Calculate and return league leaderboard.
 *
 * Requirements:
 * - Genuinely read-only: does not modify league status, persist rankings,
 *   persist returns, create notifications, or trigger background completion.
 * - Score = mark-to-market percentage return valued at:
 *   - Competition end time (if competition has ended)
 *   - Current time (if competition is active)
 *   Return % = ((Current Valuation - startingBalance) / startingBalance) * 100
 * - Trades outside [startDate, endDate] are excluded from scoring calculation.
 * - Out-of-range trades are NOT rejected at order execution layer.
 * - Tie-breaker hierarchy:
 *   1. returnPct DESC
 *   2. totalValue DESC
 *   3. tradeCount DESC
 *   4. joinedAt ASC
 *   5. userId ASC
 * - Zero-trade participants are ranked normally according to approved score and tie-breakers.
 * - For completed leagues, returns persisted final rankings and returns.
 */
async function getLeagueLeaderboard({
  leagueId,
  now = new Date(),
  priceProvider = defaultMarketData,
  finalizeIfEnded, // Retained for backwards compatibility with callers; no-op as endpoint is read-only
} = {}) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              isSuspended: true,
            },
          },
          portfolio: {
            include: {
              trades: {
                orderBy: { executedAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!league) {
    throw new AppError("League not found.", {
      statusCode: 404,
      code: "LEAGUE_NOT_FOUND",
    });
  }

  const currentDate = now instanceof Date ? now : new Date(now);
  const startDate = new Date(league.startDate);
  const endDate = new Date(league.endDate);
  const effectiveStatus = getEffectiveLeagueStatus(league, currentDate);

  // If already completed and members have finalReturn & rank, return stored results
  if (
    league.status === "COMPLETED" &&
    league.members.length > 0 &&
    league.members.every((m) => m.rank != null && m.finalReturn != null)
  ) {
    const activeMembers = league.members
      .filter((m) => !m.user?.isSuspended)
      .sort((a, b) => (a.rank || 0) - (b.rank || 0));

    return {
      league: {
        id: league.id,
        name: league.name,
        status: "COMPLETED",
        startDate: league.startDate,
        endDate: league.endDate,
      },
      leaderboard: activeMembers.map((m) => ({
        rank: m.rank,
        userId: m.userId,
        userName: m.user?.name,
        userAvatar: m.user?.avatarUrl,
        portfolioId: m.portfolioId,
        returnPct: Number(Number(m.finalReturn).toFixed(4)),
        totalValue: null,
        tradeCount: (m.portfolio?.trades || []).filter(
          (t) => t.executedAt >= startDate && t.executedAt <= endDate,
        ).length,
        joinedAt: m.joinedAt,
      })),
    };
  }

  if (league.status === "COMPLETED" && league.members.length === 0) {
    return {
      league: {
        id: league.id,
        name: league.name,
        status: "COMPLETED",
        startDate: league.startDate,
        endDate: league.endDate,
      },
      leaderboard: [],
    };
  }

  const isEnded = currentDate >= endDate || effectiveStatus === "COMPLETED" || league.status === "COMPLETED";
  const valuationDate = isEnded ? endDate : currentDate;

  const evaluatedMembers = await evaluateLeagueMembers(league, {
    valuationDate,
    priceProvider,
  });

  return {
    league: {
      id: league.id,
      name: league.name,
      status: effectiveStatus,
      startDate: league.startDate,
      endDate: league.endDate,
    },
    leaderboard: evaluatedMembers.map((m) => ({
      rank: m.rank,
      userId: m.userId,
      userName: m.userName,
      userAvatar: m.userAvatar,
      portfolioId: m.portfolioId,
      returnPct: Number(m.returnPct.toFixed(4)),
      totalValue: Number(m.totalValue.toFixed(2)),
      tradeCount: m.tradeCount,
      joinedAt: m.joinedAt,
    })),
  };
}

/**
 * Evaluate and rank league participants according to approved competition rules.
 */
async function evaluateLeagueMembers(
  league,
  { valuationDate = new Date(), priceProvider = defaultMarketData } = {},
) {
  const startDate = new Date(league.startDate);
  const endDate = new Date(league.endDate);
  const vDate = valuationDate instanceof Date ? valuationDate : new Date(valuationDate);
  const isEnded = vDate >= endDate || league.status === "COMPLETED";
  const isHistorical =
    isEnded ||
    vDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);

  const startingBalanceDec = new Prisma.Decimal(league.startingBalance);

  // Exclude suspended users from leaderboard visibility
  const candidateMembers = (league.members || []).filter(
    (m) => !m.user?.isSuspended,
  );

  const evaluatedMembers = await Promise.all(
    candidateMembers.map(async (member) => {
      const allTrades = member.portfolio?.trades || [];
      // Filter trades strictly to [startDate, endDate]
      const eligibleTrades = allTrades.filter(
        (t) => t.executedAt >= startDate && t.executedAt <= endDate,
      );
      const tradeCount = eligibleTrades.length;

      // Reconstruct cash balance and holdings solely from eligible trades
      let effectiveCash = startingBalanceDec;
      const symbolHoldings = {};

      for (const trade of eligibleTrades) {
        const qty = new Prisma.Decimal(trade.quantity);
        const price = new Prisma.Decimal(trade.price);
        const fee = new Prisma.Decimal(trade.fees ?? trade.fee ?? 0);
        const notional = qty.times(price);

        if (!symbolHoldings[trade.symbol]) {
          symbolHoldings[trade.symbol] = {
            symbol: trade.symbol,
            quantity: ZERO,
            assetType: trade.assetType || "STOCK",
            lastPrice: price,
          };
        }
        symbolHoldings[trade.symbol].lastPrice = price;

        if (trade.side === "BUY") {
          effectiveCash = effectiveCash.minus(notional).minus(fee);
          symbolHoldings[trade.symbol].quantity =
            symbolHoldings[trade.symbol].quantity.plus(qty);
        } else if (trade.side === "SELL") {
          effectiveCash = effectiveCash.plus(notional).minus(fee);
          symbolHoldings[trade.symbol].quantity =
            symbolHoldings[trade.symbol].quantity.minus(qty);
        }
      }

      // Calculate holdings value
      // Handle both long (quantity > 0) and short (quantity < 0) positions.
      // For short positions, market valuation acts as a liability deducting from portfolio value.
      let holdingsValue = ZERO;
      for (const sym of Object.keys(symbolHoldings)) {
        const h = symbolHoldings[sym];
        if (!h.quantity.isZero()) {
          let priceDecimal;
          try {
            const quote = priceProvider
              ? await resolveHoldingPrice(h, vDate, priceProvider, isHistorical)
              : null;

            if (!quote || quote.price === undefined || quote.price === null) {
              throw new Error(`Quote price is missing for ${h.symbol}`);
            }

            priceDecimal = new Prisma.Decimal(quote.price);
            if (priceDecimal.lte(ZERO)) {
              throw new Error(`Non-positive price returned for ${h.symbol}`);
            }
          } catch (error) {
            if (error instanceof AppError) {
              throw error;
            }
            throw new AppError(
              `Market price unavailable for ${h.symbol}: ${error.message}`,
              {
                statusCode: 503,
                code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
                details: { symbol: h.symbol, assetType: h.assetType },
              },
            );
          }

          holdingsValue = holdingsValue.plus(h.quantity.times(priceDecimal));
        }
      }

      const totalValue = effectiveCash.plus(holdingsValue);
      const returnPct = startingBalanceDec.isZero()
        ? ZERO
        : totalValue
            .minus(startingBalanceDec)
            .dividedBy(startingBalanceDec)
            .times(100);

      return {
        id: member.id,
        userId: member.userId,
        userName: member.user?.name,
        userAvatar: member.user?.avatarUrl,
        portfolioId: member.portfolioId,
        joinedAt: member.joinedAt,
        tradeCount,
        totalValue,
        returnPct,
      };
    }),
  );

  // Tie-breaker hierarchy:
  // 1. returnPct DESC (Prisma.Decimal)
  // 2. totalValue DESC (Prisma.Decimal)
  // 3. tradeCount DESC
  // 4. joinedAt ASC
  // 5. userId ASC
  evaluatedMembers.sort((a, b) => {
    // 1. returnPct DESC
    if (!b.returnPct.equals(a.returnPct)) {
      return b.returnPct.gt(a.returnPct) ? 1 : -1;
    }
    // 2. totalValue DESC
    if (!b.totalValue.equals(a.totalValue)) {
      return b.totalValue.gt(a.totalValue) ? 1 : -1;
    }
    // 3. tradeCount DESC
    if (b.tradeCount !== a.tradeCount) {
      return b.tradeCount - a.tradeCount;
    }
    // 4. joinedAt ASC
    const joinDiff = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    if (joinDiff !== 0) {
      return joinDiff;
    }
    // 5. userId ASC
    return a.userId.localeCompare(b.userId);
  });

  // Assign ranks
  evaluatedMembers.forEach((m, idx) => {
    m.rank = idx + 1;
  });

  return evaluatedMembers;
}

/**
 * Complete a league when its end time arrives or reconcile an already-ended league.
 * Calculates final rankings, persists results, and produces completion notifications atomically.
 * Concurrency-safe: database row lock protects the finalization decision; repeated runs or
 * concurrent worker execution will not overwrite final rankings or duplicate notifications.
 */
async function completeLeague(
  leagueId,
  {
    now = new Date(),
    priceProvider = defaultMarketData,
    client = prisma,
  } = {},
) {
  // Phase 1: Pre-fetch league state to check existence, end-date boundaries,
  // and gather necessary market data outside the transaction.
  const league = await client.league.findUnique({
    where: { id: leagueId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              isSuspended: true,
            },
          },
          portfolio: {
            include: {
              trades: {
                orderBy: { executedAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!league) {
    throw new AppError("League not found.", {
      statusCode: 404,
      code: "LEAGUE_NOT_FOUND",
    });
  }

  const currentDate = now instanceof Date ? now : new Date(now);
  const endDate = new Date(league.endDate);
  const isEnded = currentDate >= endDate || league.status === "COMPLETED";

  if (!isEnded) {
    return { completed: false, reason: "LEAGUE_NOT_ENDED", leagueId: league.id };
  }

  // Check if members already have persisted final rankings in the initial read
  const alreadyPersisted =
    league.members.length > 0 &&
    league.members.every((m) => m.rank != null && m.finalReturn != null);

  // If rankings are not already persisted, evaluate member returns outside
  // the transaction so we do not hold row locks while fetching external market data.
  let precomputedEvaluated = null;
  if (!alreadyPersisted && league.members.length > 0) {
    precomputedEvaluated = await evaluateLeagueMembers(league, {
      valuationDate: endDate,
      priceProvider,
    });
  }

  // Phase 2: Transaction with row-level locking to serialize finalization & reconciliation.
  const transactionResult = await client.$transaction(async (tx) => {
    // 1. Acquire row lock on League
    let lockedLeague;
    if (typeof tx.$queryRaw === "function") {
      const leagues = await tx.$queryRaw`
        SELECT id, status, "endDate" FROM "League" WHERE id = ${league.id} FOR UPDATE
      `;
      if (!leagues || leagues.length === 0) return { completionNotifications: [], memberCount: 0 };
      lockedLeague = leagues[0];
    } else {
      lockedLeague = await tx.league.findUnique({ where: { id: league.id } });
      if (!lockedLeague) return { completionNotifications: [], memberCount: 0 };
    }

    if (lockedLeague.status === "CANCELLED") {
      return { completionNotifications: [], memberCount: 0 };
    }

    // 2. Re-read the latest participant state inside the transaction
    const lockedMembers = await tx.leagueMember.findMany({
      where: { leagueId: league.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            isSuspended: true,
          },
        },
      },
    });

    // 3. Check whether final rankings have already been persisted
    const hasPersistedRankings =
      lockedMembers.length > 0 &&
      lockedMembers.every((m) => m.rank != null && m.finalReturn != null);

    let memberResults = [];

    if (hasPersistedRankings) {
      // Final rankings ALREADY exist (persisted previously or by a concurrent worker that won the race).
      // Preserve them! Do NOT recalculate or overwrite them.
      const activeMembers = lockedMembers
        .filter((m) => !m.user?.isSuspended)
        .sort((a, b) => (a.rank || 0) - (b.rank || 0));

      memberResults = activeMembers.map((m) => ({
        id: m.id,
        userId: m.userId,
        rank: m.rank,
        returnPct: m.finalReturn,
      }));
    } else if (lockedMembers.length > 0) {
      // Rankings do not exist yet. Use precomputed results or compute them.
      let evaluated = precomputedEvaluated;
      if (!evaluated) {
        const fullLeague = await tx.league.findUnique({
          where: { id: league.id },
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, avatarUrl: true, isSuspended: true } },
                portfolio: { include: { trades: { orderBy: { executedAt: "asc" } } } },
              },
            },
          },
        });
        evaluated = await evaluateLeagueMembers(fullLeague, {
          valuationDate: endDate,
          priceProvider,
        });
      }

      for (const m of evaluated) {
        await tx.leagueMember.update({
          where: { id: m.id },
          data: {
            rank: m.rank,
            finalReturn: m.returnPct,
          },
        });
      }

      memberResults = evaluated.map((m) => ({
        id: m.id,
        userId: m.userId,
        rank: m.rank,
        returnPct: m.returnPct,
      }));
    }

    if (lockedLeague.status !== "COMPLETED") {
      await tx.league.update({
        where: { id: league.id },
        data: { status: "COMPLETED" },
      });
    }

    // Atomically create participant completion notification records
    const notifications = [];
    for (const m of memberResults) {
      const notif = await createNotificationEvent(
        {
          eventKey: `league:${league.id}:member:${m.id}:completed`,
          userId: m.userId,
          type: "LEAGUE_UPDATE",
          title: "League results are ready",
          message: `You finished #${m.rank} in ${league.name}.`,
          data: {
            leagueId: league.id,
            leagueName: league.name,
            rank: m.rank,
            returnPct: m.returnPct.toString(),
          },
        },
        { db: tx, enqueue: false },
      );
      notifications.push(notif);
    }

    return {
      completionNotifications: notifications,
      memberCount: memberResults.length,
    };
  });

  // Post-commit: enqueue notification delivery after transaction successfully commits
  for (const notification of transactionResult.completionNotifications) {
    enqueueNotificationEvent(notification.id);
  }

  return {
    completed: true,
    leagueId: league.id,
    memberCount: transactionResult.memberCount,
    notifications: transactionResult.completionNotifications,
  };
}

/**
 * Discover and process all leagues that have reached completion or need notification reconciliation.
 */
async function processCompletedLeagues({
  now = new Date(),
  priceProvider = defaultMarketData,
  client = prisma,
  leagueId = null,
} = {}) {
  const currentDate = now instanceof Date ? now : new Date(now);

  if (leagueId) {
    const result = await completeLeague(leagueId, {
      now: currentDate,
      priceProvider,
      client,
    });
    return [result];
  }

  let leagueIds = [];
  if (typeof client.$queryRaw === "function") {
    try {
      const rows = await client.$queryRaw`
        SELECT l.id
        FROM "League" l
        WHERE (l.status IN ('UPCOMING', 'ACTIVE') AND l."endDate" <= ${currentDate})
           OR (l.status = 'COMPLETED' AND EXISTS (
             SELECT 1
             FROM "LeagueMember" lm
             JOIN "User" u ON u.id = lm."userId"
             WHERE lm."leagueId" = l.id
               AND u."isSuspended" = false
               AND (
                 lm.rank IS NULL
                 OR NOT EXISTS (
                   SELECT 1 FROM "Notification" n
                   WHERE n."eventKey" = 'league:' || l.id || ':member:' || lm.id || ':completed'
                 )
               )
           ))
      `;
      leagueIds = rows.map((r) => r.id);
    } catch {
      leagueIds = [];
    }
  }

  if (leagueIds.length === 0 && client.league && typeof client.league.findMany === "function") {
    const leagues = await client.league.findMany({
      where: {
        OR: [
          {
            status: { in: ["UPCOMING", "ACTIVE"] },
            endDate: { lte: currentDate },
          },
          {
            status: "COMPLETED",
            members: {
              some: {
                rank: null,
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    leagueIds = leagues.map((l) => l.id);
  }

  const results = [];
  for (const id of leagueIds) {
    try {
      const res = await completeLeague(id, {
        now: currentDate,
        priceProvider,
        client,
      });
      results.push(res);
    } catch (error) {
      logger.error(`Failed to process completion for league ${id}`, {
        leagueId: id,
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  createLeague,
  listLeagues,
  getLeagueById,
  joinLeague,
  getLeagueLeaderboard,
  getEffectiveLeagueStatus,
  syncLeagueStatuses,
  completeLeague,
  processCompletedLeagues,
};

