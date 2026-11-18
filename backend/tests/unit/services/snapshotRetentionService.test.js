const {
  DEFAULT_RETENTION_DAYS,
  pruneExpiredSnapshots,
} = require("../../../src/services/snapshotRetentionService");

describe("Snapshot Retention Service (Task 48.1)", () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      performanceSnapshot: {
        deleteMany: jest.fn(),
      },
    };
  });

  test("uses default retention days (365) and correctly filters older snapshots", async () => {
    const fixedNow = new Date("2026-11-18T10:00:00.000Z");
    mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 12 });

    const result = await pruneExpiredSnapshots({
      asOf: fixedNow,
      client: mockClient,
    });

    expect(result.pruned).toBe(true);
    expect(result.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(result.deletedCount).toBe(12);

    // 2026-11-18 minus 365 days is 2025-11-18
    expect(result.cutoffDate).toBe("2025-11-18");

    expect(mockClient.performanceSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        snapshotDate: {
          lt: new Date("2025-11-18T00:00:00.000Z"),
        },
      },
    });
  });

  test("supports custom retentionDays and correctly prunes older snapshots", async () => {
    const fixedNow = new Date("2026-11-18T00:00:00.000Z");
    mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 4 });

    const result = await pruneExpiredSnapshots({
      retentionDays: 90,
      asOf: fixedNow,
      client: mockClient,
    });

    expect(result.pruned).toBe(true);
    expect(result.retentionDays).toBe(90);
    expect(result.deletedCount).toBe(4);

    // 2026-11-18 minus 90 days = 2026-08-20
    expect(result.cutoffDate).toBe("2026-08-20");

    expect(mockClient.performanceSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        snapshotDate: {
          lt: new Date("2026-08-20T00:00:00.000Z"),
        },
      },
    });
  });

  test("handles zero deleted snapshots gracefully", async () => {
    mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 0 });

    const result = await pruneExpiredSnapshots({
      retentionDays: 180,
      client: mockClient,
    });

    expect(result.pruned).toBe(true);
    expect(result.deletedCount).toBe(0);
  });
});
