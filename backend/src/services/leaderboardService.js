const prisma = require("../config/database");
const { Prisma } = require("@prisma/client");

const ENTRY_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
};

const DEFAULT_PERIOD = "ALL_TIME";
const SNAPSHOT_PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"];
const ZERO = new Prisma.Decimal(0);

function serializeEntry(entry, position) {
  return {
    rank: position ?? entry.rank,
    userId: entry.userId,
    user: entry.user ?? null,
    scope: entry.scope,
    period: entry.period,
    totalValue: entry.totalValue.toString(),
    returnPct: entry.returnPct.toString(),
    snapshotDate: entry.snapshotDate,
    createdAt: entry.createdAt,
  };
}

function emptyPage(page, limit) {
  return {
    leaderboard: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
  };
}

// A leaderboard is a snapshot: read the most recent snapshotDate that has
// entries for the requested scope + period instead of mixing days together.
async function resolveSnapshotDate(scope, period) {
  const latest = await prisma.leaderboardEntry.findFirst({
    where: {
      scope,
      period,
    },
    orderBy: {
      snapshotDate: "desc",
    },
    select: {
      snapshotDate: true,
    },
  });

  return latest?.snapshotDate ?? null;
}

async function getGlobalLeaderboard({ period = DEFAULT_PERIOD, page = 1, limit = 20 } = {}) {
  const snapshotDate = await resolveSnapshotDate("GLOBAL", period);

  if (!snapshotDate) {
    return emptyPage(page, limit);
  }

  const where = {
    scope: "GLOBAL",
    period,
    snapshotDate,
  };

  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    prisma.leaderboardEntry.findMany({
      where,
      include: {
        user: {
          select: ENTRY_USER_SELECT,
        },
      },
      orderBy: {
        rank: "asc",
      },
      skip,
      take: limit,
    }),

    prisma.leaderboardEntry.count({
      where,
    }),
  ]);

  return {
    leaderboard: entries.map((entry) => serializeEntry(entry)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function getFriendsLeaderboard(userId, { period = DEFAULT_PERIOD, page = 1, limit = 20 } = {}) {
  const snapshotDate = await resolveSnapshotDate("GLOBAL", period);

  if (!snapshotDate) {
    return emptyPage(page, limit);
  }

  const following = await prisma.follow.findMany({
    where: {
      followerId: userId,
    },
    select: {
      followingId: true,
    },
  });

  const userIds = [userId, ...following.map((follow) => follow.followingId)];

  // The friends board is the global entries restricted to the caller and the
  // people they follow, re-ranked by return.
  const entries = await prisma.leaderboardEntry.findMany({
    where: {
      scope: "GLOBAL",
      period,
      snapshotDate,
      userId: {
        in: userIds,
      },
    },
    include: {
      user: {
        select: ENTRY_USER_SELECT,
      },
    },
    orderBy: [
      {
        returnPct: "desc",
      },
      {
        totalValue: "desc",
      },
    ],
  });

  const ranked = entries.map((entry, index) =>
    serializeEntry(entry, index + 1),
  );

  const total = ranked.length;
  const start = (page - 1) * limit;

  return {
    leaderboard: ranked.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

function normalizeSnapshotDate(date = new Date()) {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Snapshot date must be a valid date.");
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function getPeriodStart(period, snapshotDate) {
  const start = new Date(snapshotDate);

  if (period === "DAILY") {
    return start;
  }

  if (period === "WEEKLY") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    return start;
  }

  if (period === "MONTHLY") {
    start.setUTCDate(1);
    return start;
  }

  return null;
}

function addPortfolioToTotals(totalsByUser, portfolio) {
  const current = totalsByUser.get(portfolio.userId) ?? {
    startingBalance: ZERO,
    totalValue: ZERO,
  };

  const holdingsValue = portfolio.holdings.reduce(
    (sum, holding) => sum.plus(holding.totalInvested),
    ZERO,
  );

  current.startingBalance = current.startingBalance.plus(
    portfolio.startingBalance,
  );
  current.totalValue = current.totalValue
    .plus(portfolio.cashBalance)
    .plus(holdingsValue);

  totalsByUser.set(portfolio.userId, current);
}

function rankLeaderboard(totalsByUser, periodPnlByUser = new Map()) {
  const ranked = [];

  for (const [userId, totals] of totalsByUser) {
    if (totals.startingBalance.lte(0)) {
      continue;
    }

    const profitOrLoss = periodPnlByUser.get(userId) ?? ZERO;
    const returnPct = profitOrLoss
      .div(totals.startingBalance)
      .mul(100);

    ranked.push({
      userId,
      totalValue: totals.totalValue.toDecimalPlaces(8),
      returnPct: returnPct.toDecimalPlaces(4),
    });
  }

  ranked.sort((left, right) => {
    const returnOrder = right.returnPct.comparedTo(left.returnPct);

    if (returnOrder !== 0) {
      return returnOrder;
    }

    const valueOrder = right.totalValue.comparedTo(left.totalValue);

    if (valueOrder !== 0) {
      return valueOrder;
    }

    return left.userId.localeCompare(right.userId);
  });

  return ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

/**
 * Calculate and persist one GLOBAL leaderboard snapshot per supported period.
 * Portfolio value is cash plus the recorded invested basis of open holdings.
 * Period returns use realized P&L during that UTC period; ALL_TIME return uses
 * current portfolio value against total starting balance.
 */
async function generateLeaderboardSnapshots({ date = new Date() } = {}) {
  const snapshotDate = normalizeSnapshotDate(date);
  const nextDay = new Date(snapshotDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  return prisma.$transaction(async (transaction) => {
    const portfolios = await transaction.portfolio.findMany({
      where: {
        user: {
          isSuspended: false,
        },
      },
      select: {
        id: true,
        userId: true,
        startingBalance: true,
        cashBalance: true,
        holdings: {
          select: {
            totalInvested: true,
          },
        },
      },
    });

    const totalsByUser = new Map();
    const userIdByPortfolioId = new Map();

    for (const portfolio of portfolios) {
      addPortfolioToTotals(totalsByUser, portfolio);
      userIdByPortfolioId.set(portfolio.id, portfolio.userId);
    }

    const results = [];

    for (const period of SNAPSHOT_PERIODS) {
      const periodStart = getPeriodStart(period, snapshotDate);
      const periodPnlByUser = new Map();

      if (periodStart && portfolios.length > 0) {
        const portfolioPnl = await transaction.trade.groupBy({
          by: ["portfolioId"],
          where: {
            portfolioId: {
              in: portfolios.map((portfolio) => portfolio.id),
            },
            executedAt: {
              gte: periodStart,
              lt: nextDay,
            },
          },
          _sum: {
            realizedPnl: true,
          },
        });

        for (const row of portfolioPnl) {
          const userId = userIdByPortfolioId.get(row.portfolioId);

          if (userId) {
            periodPnlByUser.set(
              userId,
              (periodPnlByUser.get(userId) ?? ZERO).plus(
                row._sum.realizedPnl ?? ZERO,
              ),
            );
          }
        }
      } else if (period === "ALL_TIME") {
        for (const [userId, totals] of totalsByUser) {
          periodPnlByUser.set(
            userId,
            totals.totalValue.minus(totals.startingBalance),
          );
        }
      }

      const ranked = rankLeaderboard(totalsByUser, periodPnlByUser);
      const data = ranked.map((entry) => ({
        userId: entry.userId,
        scope: "GLOBAL",
        period,
        rank: entry.rank,
        totalValue: entry.totalValue.toFixed(8),
        returnPct: entry.returnPct.toFixed(4),
        snapshotDate,
      }));

      await transaction.leaderboardEntry.deleteMany({
        where: {
          scope: "GLOBAL",
          period,
          snapshotDate,
        },
      });

      if (data.length > 0) {
        await transaction.leaderboardEntry.createMany({ data });
      }

      results.push({ period, entries: data.length });
    }

    return {
      snapshotDate,
      leaderboards: results,
    };
  });
}

module.exports = {
  getGlobalLeaderboard,
  getFriendsLeaderboard,
  generateLeaderboardSnapshots,
};
