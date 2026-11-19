jest.mock("../../../src/config/database", () => ({
  leaderboardSnapshot: {
    findFirst: jest.fn(),
  },
  leaderboardEntry: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  follow: {
    findMany: jest.fn(),
  },
}));

const prisma = require("../../../src/config/database");
const {
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  getLeaderboardHistory,
} = require("../../../src/services/leaderboardService");

const emptyPage = (page = 1, limit = 20) => ({
  leaderboard: [],
  pagination: {
    page,
    limit,
    total: 0,
    totalPages: 0,
  },
});

describe("leaderboard reads with no snapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.leaderboardSnapshot.findFirst.mockResolvedValue(null);
  });

  test("returns an empty global page without querying entries", async () => {
    await expect(getGlobalLeaderboard({ period: "WEEKLY" })).resolves.toEqual(
      emptyPage(),
    );

    expect(prisma.leaderboardSnapshot.findFirst).toHaveBeenCalledWith({
      where: { scope: "GLOBAL", period: "WEEKLY" },
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    });
    expect(prisma.leaderboardEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.leaderboardEntry.count).not.toHaveBeenCalled();
  });

  test("returns an empty friends page without querying follows or entries", async () => {
    await expect(
      getFriendsLeaderboard("user-id", { period: "WEEKLY" }),
    ).resolves.toEqual(emptyPage());

    expect(prisma.follow.findMany).not.toHaveBeenCalled();
    expect(prisma.leaderboardEntry.findMany).not.toHaveBeenCalled();
  });

  test("returns an empty history page without querying entries", async () => {
    await expect(getLeaderboardHistory({ period: "WEEKLY" })).resolves.toEqual(
      emptyPage(),
    );

    expect(prisma.leaderboardEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.leaderboardEntry.count).not.toHaveBeenCalled();
  });
});
