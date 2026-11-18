const {
  isTransientError,
  parseRetryAfter,
  calculateBackoffDelay,
  getData,
} = require("../../../src/providers/marketDataHttp");

describe("Provider transient retry and backoff", () => {
  describe("isTransientError", () => {
    test("identifies rate limit and teapot errors as transient", () => {
      expect(isTransientError({ response: { status: 429 } })).toBe(true);
      expect(isTransientError({ response: { status: 418 } })).toBe(true);
      expect(
        isTransientError({
          response: { status: 403, data: { msg: "Too many requests. Rate limit exceeded." } },
        }),
      ).toBe(true);
    });

    test("identifies server errors as transient", () => {
      expect(isTransientError({ response: { status: 500 } })).toBe(true);
      expect(isTransientError({ response: { status: 502 } })).toBe(true);
      expect(isTransientError({ response: { status: 503 } })).toBe(true);
      expect(isTransientError({ response: { status: 504 } })).toBe(true);
    });

    test("identifies timeouts and socket disconnects as transient", () => {
      expect(isTransientError({ code: "ECONNABORTED" })).toBe(true);
      expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
      expect(isTransientError({ code: "ESOCKETTIMEDOUT" })).toBe(true);
      expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientError({ code: "ECONNREFUSED" })).toBe(true);
      expect(isTransientError({ name: "TimeoutError" })).toBe(true);
      expect(isTransientError({ message: "timeout of 5000ms exceeded" })).toBe(true);
    });

    test("does not mark client validation or missing symbol errors as transient", () => {
      expect(isTransientError({ response: { status: 400 } })).toBe(false);
      expect(isTransientError({ response: { status: 404 } })).toBe(false);
      expect(isTransientError({ response: { status: 422 } })).toBe(false);
      expect(
        isTransientError({
          response: { status: 400, data: { code: -1121, msg: "Invalid symbol." } },
        }),
      ).toBe(false);
    });

    test("does not mark invalid credentials as transient", () => {
      expect(isTransientError({ response: { status: 401 } })).toBe(false);
      expect(isTransientError({ response: { status: 403, data: { msg: "Forbidden" } } })).toBe(
        false,
      );
    });
  });

  describe("parseRetryAfter", () => {
    test("parses numeric seconds into milliseconds", () => {
      expect(parseRetryAfter({ "retry-after": "3" })).toBe(3000);
      expect(parseRetryAfter({ "Retry-After": "1.5" })).toBe(1500);
    });

    test("parses future HTTP dates into positive millisecond duration", () => {
      const future = new Date(Date.now() + 5000).toUTCString();
      const parsed = parseRetryAfter({ "retry-after": future });
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(5000);
    });

    test("returns null for invalid or missing headers", () => {
      expect(parseRetryAfter(null)).toBeNull();
      expect(parseRetryAfter({})).toBeNull();
      expect(parseRetryAfter({ "retry-after": "invalid-date" })).toBeNull();
    });
  });

  describe("calculateBackoffDelay", () => {
    test("computes exponential backoff without jitter", () => {
      const delay0 = calculateBackoffDelay(0, { baseDelayMs: 100, maxDelayMs: 1000, jitter: false });
      const delay1 = calculateBackoffDelay(1, { baseDelayMs: 100, maxDelayMs: 1000, jitter: false });
      const delay2 = calculateBackoffDelay(2, { baseDelayMs: 100, maxDelayMs: 1000, jitter: false });

      expect(delay0).toBe(100);
      expect(delay1).toBe(200);
      expect(delay2).toBe(400);
    });

    test("caps at maxDelayMs", () => {
      const delay = calculateBackoffDelay(10, { baseDelayMs: 100, maxDelayMs: 500, jitter: false });
      expect(delay).toBe(500);
    });

    test("honors provider retryAfterMs when provided", () => {
      const delay = calculateBackoffDelay(0, {
        baseDelayMs: 100,
        maxDelayMs: 2000,
        retryAfterMs: 750,
      });
      expect(delay).toBe(750);
    });

    test("returns null when retryAfterMs exceeds maxDelayMs to prevent early retry", () => {
      const delay = calculateBackoffDelay(0, {
        baseDelayMs: 100,
        maxDelayMs: 2000,
        retryAfterMs: 5000,
      });
      expect(delay).toBeNull();
    });
  });

  describe("getData retries", () => {
    test("succeeds on first attempt without retrying", async () => {
      const client = {
        get: jest.fn().mockResolvedValue({ data: { c: 150.25 } }),
      };
      const sleep = jest.fn();

      const result = await getData(client, "/quote", { symbol: "AAPL" }, { sleep });

      expect(result).toEqual({ c: 150.25 });
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("retries transient failure and succeeds on subsequent attempt", async () => {
      const client = {
        get: jest
          .fn()
          .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
          .mockResolvedValueOnce({ data: { c: 150.25 } }),
      };
      const sleep = jest.fn().mockResolvedValue();

      const result = await getData(
        client,
        "/quote",
        { symbol: "AAPL" },
        { retries: 2, sleep, jitter: false },
      );

      expect(result).toEqual({ c: 150.25 });
      expect(client.get).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    test("respects Retry-After header duration during transient throttling", async () => {
      const client = {
        get: jest
          .fn()
          .mockRejectedValueOnce({
            response: {
              status: 429,
              headers: { "retry-after": "1" },
              data: { msg: "rate limit" },
            },
          })
          .mockResolvedValueOnce({ data: { c: 150.25 } }),
      };
      const sleep = jest.fn().mockResolvedValue();

      const result = await getData(
        client,
        "/quote",
        { symbol: "AAPL" },
        { retries: 2, sleep, maxDelayMs: 5000 },
      );

      expect(result).toEqual({ c: 150.25 });
      expect(client.get).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(1000);
    });

    test("fails immediately without retrying on permanent 404 error", async () => {
      const client = {
        get: jest.fn().mockRejectedValue({
          response: { status: 404, data: { msg: "Unknown symbol" } },
        }),
      };
      const sleep = jest.fn();

      await expect(
        getData(client, "/quote", { symbol: "INVALID" }, { retries: 3, sleep }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "MARKET_DATA_NOT_FOUND",
      });

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("fails immediately without retrying early when provider Retry-After exceeds maxDelayMs", async () => {
      const client = {
        get: jest.fn().mockRejectedValue({
          response: {
            status: 429,
            headers: { "retry-after": "60" }, // 60 seconds = 60,000ms
            data: { msg: "rate limited" },
          },
        }),
      };
      const sleep = jest.fn();

      await expect(
        getData(
          client,
          "/quote",
          { symbol: "AAPL" },
          { retries: 3, sleep, maxDelayMs: 2000 },
        ),
      ).rejects.toMatchObject({
        statusCode: 429,
        code: "MARKET_DATA_RATE_LIMITED",
      });

      // Crucial: Must NEVER retry early when provider requested 60s but maxDelayMs was only 2s!
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("honors retry configuration wired on client.retryConfig", async () => {
      const client = {
        retryConfig: {
          maxRetries: 4,
          baseDelayMs: 25,
          maxDelayMs: 200,
        },
        get: jest
          .fn()
          .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
          .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
          .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
          .mockResolvedValueOnce({ data: { c: 200.5 } }),
      };
      const sleep = jest.fn().mockResolvedValue();

      const result = await getData(
        client,
        "/quote",
        { symbol: "AAPL" },
        { sleep, jitter: false },
      );

      expect(result).toEqual({ c: 200.5 });
      expect(client.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(sleep).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenNthCalledWith(1, 25);
      expect(sleep).toHaveBeenNthCalledWith(2, 50);
      expect(sleep).toHaveBeenNthCalledWith(3, 100);
    });

    test("honors environment-driven retry configuration from environment variables", async () => {
      const originalRetries = process.env.MARKET_DATA_MAX_RETRIES;
      const originalBase = process.env.MARKET_DATA_RETRY_BASE_DELAY_MS;
      const originalMax = process.env.MARKET_DATA_RETRY_MAX_DELAY_MS;

      try {
        process.env.MARKET_DATA_MAX_RETRIES = "3";
        process.env.MARKET_DATA_RETRY_BASE_DELAY_MS = "40";
        process.env.MARKET_DATA_RETRY_MAX_DELAY_MS = "500";

        const client = {
          get: jest
            .fn()
            .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
            .mockRejectedValueOnce({ response: { status: 503, data: { msg: "busy" } } })
            .mockResolvedValueOnce({ data: { c: 300 } }),
        };
        const sleep = jest.fn().mockResolvedValue();

        const result = await getData(
          client,
          "/quote",
          { symbol: "AAPL" },
          { sleep, jitter: false },
        );

        expect(result).toEqual({ c: 300 });
        expect(client.get).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenNthCalledWith(1, 40);
        expect(sleep).toHaveBeenNthCalledWith(2, 80);
      } finally {
        if (originalRetries !== undefined) process.env.MARKET_DATA_MAX_RETRIES = originalRetries;
        else delete process.env.MARKET_DATA_MAX_RETRIES;
        if (originalBase !== undefined) process.env.MARKET_DATA_RETRY_BASE_DELAY_MS = originalBase;
        else delete process.env.MARKET_DATA_RETRY_BASE_DELAY_MS;
        if (originalMax !== undefined) process.env.MARKET_DATA_RETRY_MAX_DELAY_MS = originalMax;
        else delete process.env.MARKET_DATA_RETRY_MAX_DELAY_MS;
      }
    });

    test("exhausts retry attempts on persistent transient error", async () => {
      const client = {
        get: jest.fn().mockRejectedValue({
          response: { status: 503, data: { msg: "Unavailable" } },
        }),
      };
      const sleep = jest.fn().mockResolvedValue();

      await expect(
        getData(client, "/quote", { symbol: "AAPL" }, { retries: 2, sleep }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      });

      expect(client.get).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect(sleep).toHaveBeenCalledTimes(2);
    });
  });
});
