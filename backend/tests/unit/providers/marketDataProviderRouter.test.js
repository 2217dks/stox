const {
  createMarketDataProviderRouter,
} = require("../../../src/providers/marketDataProviderRouter");
const {
  createMarketDataError,
} = require("../../../src/providers/marketDataErrors");

function provider(id, overrides = {}) {
  return {
    id,
    assetClasses: ["STOCK"],
    ...overrides,
  };
}

function router({ chain = ["primary", "fallback"], providers, log } = {}) {
  return createMarketDataProviderRouter({
    config: {
      providerChains: { STOCK: chain, CRYPTO: ["crypto"] },
    },
    providers,
    log: log || { warn: jest.fn() },
  });
}

const resolved = { canonicalSymbol: "AAPL", assetClass: "STOCK" };
const invoke = (adapter, providerSymbol) => adapter.getQuote(providerSymbol);

describe("marketDataProviderRouter", () => {
  test("falls back and logs a safe routing event", async () => {
    const warn = jest.fn();
    const primary = provider("primary", {
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "Market data provider is unavailable.",
            503,
            "MARKET_DATA_PROVIDER_UNAVAILABLE",
          ),
        ),
    });
    const fallback = provider("fallback", {
      getQuote: jest.fn().mockResolvedValue("fallback"),
    });

    const result = await router({
      providers: { primary, fallback },
      log: { warn },
    }).run({
      assetClass: "STOCK",
      operation: "quote",
      resolved,
      invoke,
    });

    expect(result).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(
      "Market data provider failed; trying fallback",
      expect.objectContaining({
        operation: "quote",
        provider: "primary",
        fallback: "fallback",
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      }),
    );
  });

  test("returns a client error without trying the fallback", async () => {
    const primary = provider("primary", {
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "The market data request is invalid.",
            400,
            "MARKET_DATA_INVALID_REQUEST",
          ),
        ),
    });
    const fallback = provider("fallback", { getQuote: jest.fn() });

    await expect(
      router({ providers: { primary, fallback } }).run({
        assetClass: "STOCK",
        operation: "quote",
        resolved,
        invoke,
      }),
    ).rejects.toMatchObject({ code: "MARKET_DATA_INVALID_REQUEST" });
    expect(fallback.getQuote).not.toHaveBeenCalled();
  });

  test("filters by operation and market metadata", () => {
    const historyOnly = provider("history-only", {
      operations: ["history"],
      getHistoricalPrices: jest.fn(),
    });
    const usOnly = provider("us-only", {
      markets: ["US"],
      getQuote: jest.fn(),
    });
    const global = provider("global", { markets: ["*"], getQuote: jest.fn() });

    const candidates = router({
      chain: ["history-only", "us-only", "global"],
      providers: { "history-only": historyOnly, "us-only": usOnly, global },
    }).candidatesFor({
      assetClass: "STOCK",
      operation: "quote",
      resolved: { canonicalSymbol: "VOD.L", assetClass: "STOCK" },
    });

    expect(candidates).toEqual([global]);
  });

  test("uses each adapter's provider symbol translation", async () => {
    const adapter = provider("adapter", {
      getQuote: jest.fn().mockResolvedValue("ok"),
      toProviderSymbol: jest.fn(() => "TRANSLATED"),
    });

    await router({
      chain: ["adapter"],
      providers: { adapter },
    }).run({
      assetClass: "STOCK",
      operation: "quote",
      resolved,
      invoke,
    });

    expect(adapter.toProviderSymbol).toHaveBeenCalledWith("AAPL", {
      assetClass: "STOCK",
    });
    expect(adapter.getQuote).toHaveBeenCalledWith("TRANSLATED");
  });

  test("deduplicates providers in chain to prevent duplicate candidate invocation", () => {
    const adapter = provider("finnhub", {
      markets: ["US"],
      getQuote: jest.fn(),
    });

    const candidates = router({
      chain: ["finnhub", "finnhub"],
      providers: { finnhub: adapter },
    }).candidatesFor({
      assetClass: "STOCK",
      operation: "quote",
      resolved: { canonicalSymbol: "AAPL", assetClass: "STOCK" },
    });

    expect(candidates).toEqual([adapter]);
  });

  test("warns and skips configured providers missing from the registry", () => {
    const warn = jest.fn();
    const adapter = provider("finnhub", {
      markets: ["US"],
      getQuote: jest.fn(),
    });

    const candidates = router({
      chain: ["missing_provider", "finnhub"],
      providers: { finnhub: adapter },
      log: { warn },
    }).candidatesFor({
      assetClass: "STOCK",
      operation: "quote",
      resolved: { canonicalSymbol: "AAPL", assetClass: "STOCK" },
    });

    expect(candidates).toEqual([adapter]);
    expect(warn).toHaveBeenCalledWith(
      "Configured market data provider not registered",
      expect.objectContaining({
        provider: "missing_provider",
        assetClass: "STOCK",
      }),
    );
  });

  test("throws 503 MARKET_DATA_PROVIDER_UNAVAILABLE when no candidates match", () => {
    expect(() =>
      router({
        chain: ["finnhub"],
        providers: {},
      }).candidatesFor({
        assetClass: "STOCK",
        operation: "quote",
        resolved: { canonicalSymbol: "AAPL", assetClass: "STOCK" },
      }),
    ).toThrow(
      expect.objectContaining({
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      }),
    );
  });

  test("throws 503 MARKET_DATA_NOT_CONFIGURED when asset class has no chain", () => {
    expect(() =>
      router({
        chain: ["finnhub"],
        providers: {},
      }).candidatesFor({
        assetClass: "FOREX",
        operation: "quote",
        resolved: { canonicalSymbol: "EURUSD", assetClass: "FOREX" },
      }),
    ).toThrow(
      expect.objectContaining({
        statusCode: 503,
        code: "MARKET_DATA_NOT_CONFIGURED",
      }),
    );
  });
});
