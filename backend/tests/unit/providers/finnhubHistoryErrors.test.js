const {
  createFinnhubMarketDataProvider,
} = require("../../../src/providers/finnhubMarketDataProvider");

const BASE_SECONDS = 1_700_000_000;

describe("Finnhub historical errors", () => {
  test("propagates a candle access failure to the provider router", async () => {
    const httpClient = {
      get: jest.fn().mockRejectedValue({
        response: {
          status: 403,
          data: { error: "You don't have access to this resource." },
        },
      }),
    };
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", baseUrl: "https://finnhub.test", timeoutMs: 5000 },
      { httpClient },
    );

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "1d",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_INVALID_CREDENTIALS",
    });
  });

  test("adds no adapter-level request beyond the shared retry policy", async () => {
    const httpClient = {
      get: jest.fn().mockRejectedValue({
        response: { status: 500, data: {} },
      }),
    };
    // Retries now belong to the shared HTTP layer (`getData`). Disable them
    // here so this test still asserts that the adapter itself never issues a
    // duplicate request for a provider-level failure.
    const provider = createFinnhubMarketDataProvider(
      {
        apiKey: "test-key",
        baseUrl: "https://finnhub.test",
        timeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      },
      { httpClient },
    );

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "1d",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({ code: "MARKET_DATA_PROVIDER_UNAVAILABLE" });

    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });
});
