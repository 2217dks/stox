const originalRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
const originalGlobalMax = process.env.RATE_LIMIT_GLOBAL_MAX;
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_GLOBAL_MAX = "1";

jest.mock("../../src/services/marketData", () => ({
  searchSymbols: jest.fn().mockResolvedValue([]),
}));

const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");

afterAll(() => {
  if (originalRateLimitEnabled === undefined) {
    delete process.env.RATE_LIMIT_ENABLED;
  } else {
    process.env.RATE_LIMIT_ENABLED = originalRateLimitEnabled;
  }

  if (originalGlobalMax === undefined) {
    delete process.env.RATE_LIMIT_GLOBAL_MAX;
  } else {
    process.env.RATE_LIMIT_GLOBAL_MAX = originalGlobalMax;
  }
});

describe("market API global rate limit", () => {
  test("limits public market requests with the standard 429 response", async () => {
    const first = await request(app).get("/api/v1/market/search?query=apple");
    const second = await request(app).get("/api/v1/market/search?query=apple");

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ success: true, data: [] });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    });
    expect(second.headers["ratelimit-limit"]).toBe("1");
    expect(second.headers["ratelimit-remaining"]).toBe("0");
    expect(marketDataService.searchSymbols).toHaveBeenCalledTimes(1);
  });
});
