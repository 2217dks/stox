const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { AppError } = require("../utils/errors");

const ZERO = new Prisma.Decimal(0);

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
  let status = "UPCOMING";
  if (now >= start && now < end) {
    status = "ACTIVE";
  } else if (now >= end) {
    status = "COMPLETED";
  }

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
async function listLeagues({ status, page = 1, limit = 20 } = {}) {
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
      status: l.status,
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
async function getLeagueById(id) {
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
 * - Late joining after startDate is strictly disallowed.
 * - League status must be UPCOMING and now < startDate.
 * - Duplicate join is rejected (409).
 * - Member capacity is enforced if maxParticipants is defined.
 * - Uses dedicated competition portfolio (or supplied unused user portfolio).
 */
async function joinLeague({ leagueId, userId, portfolioId, now = new Date() }) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
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

  const currentDate = now instanceof Date ? now : new Date(now);

  // Late joining disallowed: joinedAt <= startDate required; joining requires status UPCOMING and now < startDate
  if (currentDate >= new Date(league.startDate) || league.status !== "UPCOMING") {
    throw new AppError("Cannot join league after it has started.", {
      statusCode: 400,
      code: "LEAGUE_ALREADY_STARTED",
    });
  }

  if (league.maxParticipants && league._count.members >= league.maxParticipants) {
    throw new AppError("League is full.", {
      statusCode: 400,
      code: "LEAGUE_FULL",
    });
  }

  const existingMember = await prisma.leagueMember.findUnique({
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

  let targetPortfolioId = portfolioId;

  if (targetPortfolioId) {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: targetPortfolioId, userId },
    });
    if (!portfolio) {
      throw new AppError("Portfolio not found or does not belong to user.", {
        statusCode: 404,
        code: "PORTFOLIO_NOT_FOUND",
      });
    }
    const portfolioUsed = await prisma.leagueMember.findUnique({
      where: { portfolioId: targetPortfolioId },
    });
    if (portfolioUsed) {
      throw new AppError("Portfolio is already assigned to a league.", {
        statusCode: 409,
        code: "PORTFOLIO_ALREADY_IN_LEAGUE",
      });
    }
  } else {
    // Create dedicated competition portfolio
    const newPortfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: `${league.name} - ${Date.now()}`,
        description: `Competition portfolio for ${league.name}`,
        startingBalance: league.startingBalance,
        cashBalance: league.startingBalance,
        reservedCash: ZERO,
        isDefault: false,
        isActive: true,
      },
    });
    targetPortfolioId = newPortfolio.id;
  }

  const member = await prisma.leagueMember.create({
    data: {
      leagueId,
      userId,
      portfolioId: targetPortfolioId,
      joinedAt: currentDate,
    },
    include: {
      portfolio: true,
    },
  });

  return member;
}

/**
 * Calculate and return league leaderboard.
 *
 * Scoring:
 * - Mark-to-market percentage return:
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
 * - When competition completes (now >= endDate or COMPLETED), finalReturn and rank are persisted.
 */
async function getLeagueLeaderboard({
  leagueId,
  now = new Date(),
  priceProvider = defaultMarketData,
  finalizeIfEnded = true,
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

  // If already completed and members have finalReturn & rank, return stored results
  if (
    league.status === "COMPLETED" &&
    league.members.length > 0 &&
    league.members.every((m) => m.rank !== null && m.finalReturn !== null)
  ) {
    const activeMembers = league.members
      .filter((m) => !m.user.isSuspended)
      .sort((a, b) => (a.rank || 0) - (b.rank || 0));

    return {
      league: {
        id: league.id,
        name: league.name,
        status: league.status,
        startDate: league.startDate,
        endDate: league.endDate,
      },
      leaderboard: activeMembers.map((m) => ({
        rank: m.rank,
        userId: m.userId,
        userName: m.user.name,
        userAvatar: m.user.avatarUrl,
        portfolioId: m.portfolioId,
        returnPct: Number(m.finalReturn),
        totalValue: null,
        tradeCount: m.portfolio.trades.filter(
          (t) => t.executedAt >= startDate && t.executedAt <= endDate,
        ).length,
        joinedAt: m.joinedAt,
      })),
    };
  }

  const isEnded = currentDate >= endDate || league.status === "COMPLETED";
  const valuationDate = isEnded ? endDate : currentDate;

  const startingBalanceDec = new Prisma.Decimal(league.startingBalance);

  // Exclude suspended users from leaderboard visibility
  const candidateMembers = league.members.filter((m) => !m.user.isSuspended);

  const evaluatedMembers = await Promise.all(
    candidateMembers.map(async (member) => {
      const allTrades = member.portfolio.trades || [];
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
        const fee = new Prisma.Decimal(trade.fee || 0);
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
      let holdingsValue = ZERO;
      for (const sym of Object.keys(symbolHoldings)) {
        const h = symbolHoldings[sym];
        if (h.quantity.gt(ZERO)) {
          let price = h.lastPrice;
          try {
            if (priceProvider) {
              if (isEnded && typeof priceProvider.getHistoricalPrice === "function") {
                const hist = await priceProvider.getHistoricalPrice(h.symbol, {
                  asOf: valuationDate,
                  assetClass: h.assetType,
                });
                if (hist && hist.price !== undefined && hist.price !== null) {
                  price = new Prisma.Decimal(hist.price);
                }
              } else if (!isEnded && typeof priceProvider.getQuote === "function") {
                const q = await priceProvider.getQuote(h.symbol, {
                  assetClass: h.assetType,
                });
                if (q && q.price !== undefined && q.price !== null) {
                  price = new Prisma.Decimal(q.price);
                }
              }
            }
          } catch {
            price = h.lastPrice;
          }
          holdingsValue = holdingsValue.plus(h.quantity.times(price));
        }
      }

      const totalValue = effectiveCash.plus(holdingsValue);
      const returnPct = startingBalanceDec.isZero()
        ? 0
        : totalValue
            .minus(startingBalanceDec)
            .dividedBy(startingBalanceDec)
            .times(100)
            .toNumber();

      return {
        id: member.id,
        userId: member.userId,
        userName: member.user.name,
        userAvatar: member.user.avatarUrl,
        portfolioId: member.portfolioId,
        joinedAt: member.joinedAt,
        tradeCount,
        totalValue,
        returnPct,
      };
    }),
  );

  // Tie-breaker hierarchy:
  // 1. returnPct DESC
  // 2. totalValue DESC
  // 3. tradeCount DESC
  // 4. joinedAt ASC
  // 5. userId ASC
  evaluatedMembers.sort((a, b) => {
    // 1. returnPct DESC
    if (b.returnPct !== a.returnPct) {
      return b.returnPct - a.returnPct;
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

  // If ended and finalizeIfEnded is true, persist finalReturn and rank
  if (isEnded && finalizeIfEnded && evaluatedMembers.length > 0) {
    await prisma.$transaction([
      prisma.league.update({
        where: { id: league.id },
        data: { status: "COMPLETED" },
      }),
      ...evaluatedMembers.map((m) =>
        prisma.leagueMember.update({
          where: { id: m.id },
          data: {
            rank: m.rank,
            finalReturn: new Prisma.Decimal(m.returnPct.toFixed(4)),
          },
        }),
      ),
    ]);
  }

  return {
    league: {
      id: league.id,
      name: league.name,
      status: isEnded ? "COMPLETED" : league.status,
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

module.exports = {
  createLeague,
  listLeagues,
  getLeagueById,
  joinLeague,
  getLeagueLeaderboard,
};
