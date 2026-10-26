const prisma = require("../config/database");

const ENTRY_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
};

const DEFAULT_PERIOD = "ALL_TIME";

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

module.exports = {
  getGlobalLeaderboard,
  getFriendsLeaderboard,
};
