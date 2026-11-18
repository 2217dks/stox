const {
  evaluateQuoteFreshness,
  assertQuoteFreshness,
} = require("../../../src/utils/quoteFreshness");

describe("quoteFreshness", () => {
  const baseTime = 1793577600000; // Reference fixed now epoch (ms)
  const now = () => baseTime;

  describe("evaluateQuoteFreshness", () => {
    test("marks crypto quote fresh when within threshold (<= 60s)", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime - 30 * 1000).toISOString(), // 30s ago
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: false,
        freshness: "FRESH",
        ageSeconds: 30,
      });
    });

    test("marks crypto quote stale when older than threshold (> 60s)", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime - 90 * 1000).toISOString(), // 90s ago
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: true,
        freshness: "STALE",
        ageSeconds: 90,
      });
    });

    test("marks stock quote fresh when within 300s threshold", () => {
      const quote = {
        symbol: "AAPL",
        assetClass: "STOCK",
        price: "150.00",
        timestamp: new Date(baseTime - 240 * 1000).toISOString(), // 4 min ago
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: false,
        freshness: "FRESH",
        ageSeconds: 240,
      });
    });

    test("marks stock quote stale when older than 300s", () => {
      const quote = {
        symbol: "AAPL",
        assetClass: "STOCK",
        price: "150.00",
        timestamp: new Date(baseTime - 600 * 1000).toISOString(), // 10 min ago
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: true,
        freshness: "STALE",
        ageSeconds: 600,
      });
    });

    test("respects explicit thresholdSeconds override", () => {
      const quote = {
        symbol: "AAPL",
        assetClass: "STOCK",
        price: "150.00",
        timestamp: new Date(baseTime - 20 * 1000).toISOString(), // 20s ago
      };

      const evaluated = evaluateQuoteFreshness(quote, {
        now,
        thresholdSeconds: 15, // custom 15s threshold
      });

      expect(evaluated).toMatchObject({
        isStale: true,
        freshness: "STALE",
        ageSeconds: 20,
      });
    });

    test("marks quote fresh with ageSeconds = 0 when timestamp is ahead within acceptable clock skew (<= 5s)", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime + 3 * 1000).toISOString(), // 3s ahead (within 5s clock skew)
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: false,
        isFuture: false,
        freshness: "FRESH",
        ageSeconds: 0,
      });
    });

    test("marks quote as FUTURE, isStale = true, and ageSeconds = null when timestamp is significantly ahead (> 5s)", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime + 30 * 1000).toISOString(), // 30s ahead in the future
      };

      const evaluated = evaluateQuoteFreshness(quote, { now });

      expect(evaluated).toMatchObject({
        isStale: true,
        isFuture: true,
        freshness: "FUTURE",
        ageSeconds: null,
      });
    });

    test("handles missing or invalid timestamp gracefully", () => {
      const missing = evaluateQuoteFreshness({ price: "100" }, { now });
      expect(missing).toMatchObject({
        isStale: true,
        isFuture: false,
        freshness: "STALE",
        ageSeconds: null,
      });

      const invalid = evaluateQuoteFreshness(
        { price: "100", timestamp: "invalid-date" },
        { now },
      );
      expect(invalid).toMatchObject({
        isStale: true,
        isFuture: false,
        freshness: "STALE",
        ageSeconds: null,
      });
    });
  });

  describe("assertQuoteFreshness", () => {
    test("returns evaluated quote when not rejecting stale", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        timestamp: new Date(baseTime - 120 * 1000).toISOString(),
      };

      const result = assertQuoteFreshness(quote, { now, rejectStale: false });
      expect(result.isStale).toBe(true);
      expect(result.freshness).toBe("STALE");
    });

    test("throws 503 MARKET_DATA_STALE_QUOTE when rejectStale is true and quote is stale", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        timestamp: new Date(baseTime - 120 * 1000).toISOString(),
      };

      expect(() =>
        assertQuoteFreshness(quote, { now, rejectStale: true }),
      ).toThrow("Market data quote is stale or delayed.");

      try {
        assertQuoteFreshness(quote, { now, rejectStale: true });
      } catch (error) {
        expect(error.statusCode).toBe(503);
        expect(error.code).toBe("MARKET_DATA_STALE_QUOTE");
      }
    });

    test("throws 503 when maxAgeSeconds is exceeded", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        timestamp: new Date(baseTime - 25 * 1000).toISOString(), // 25s old
      };

      expect(() =>
        assertQuoteFreshness(quote, { now, maxAgeSeconds: 10 }),
      ).toThrow("Market data quote is stale or delayed.");
    });

    test("throws 503 when quote timestamp is missing and maxAgeSeconds is specified", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
      };

      expect(() =>
        assertQuoteFreshness(quote, { now, maxAgeSeconds: 10 }),
      ).toThrow("Market data quote is stale or delayed.");
    });

    test("throws 503 when quote timestamp is in the future and rejectStale is true", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime + 60 * 1000).toISOString(), // 60s in future
      };

      expect(() =>
        assertQuoteFreshness(quote, { now, rejectStale: true }),
      ).toThrow("Market data quote is stale or delayed.");
    });

    test("throws 503 when quote timestamp is in the future and maxAgeSeconds is specified", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime + 60 * 1000).toISOString(), // 60s in future
      };

      expect(() =>
        assertQuoteFreshness(quote, { now, maxAgeSeconds: 10 }),
      ).toThrow("Market data quote is stale or delayed.");
    });

    test("passes when quote is ahead within acceptable clock skew", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        price: "60000.00",
        timestamp: new Date(baseTime + 3 * 1000).toISOString(), // 3s ahead
      };

      const result = assertQuoteFreshness(quote, { now, rejectStale: true, maxAgeSeconds: 10 });
      expect(result.isStale).toBe(false);
      expect(result.freshness).toBe("FRESH");
    });

    test("passes when maxAgeSeconds is not exceeded", () => {
      const quote = {
        symbol: "BTCUSDT",
        assetClass: "CRYPTO",
        timestamp: new Date(baseTime - 5 * 1000).toISOString(), // 5s old
      };

      const result = assertQuoteFreshness(quote, { now, maxAgeSeconds: 10 });
      expect(result.isStale).toBe(false);
      expect(result.ageSeconds).toBe(5);
    });
  });
});
