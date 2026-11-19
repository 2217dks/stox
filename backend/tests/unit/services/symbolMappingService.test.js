const {
  toCanonicalSymbol,
  toProviderSymbol,
  toDisplaySymbol,
  parseSymbol,
  parseProviderPrefix,
  inferAssetClass,
  normalizeAssetClass,
  normalizeSymbol,
  resolveSymbol,
  resolveSymbols,
  KNOWN_AMBIGUOUS_STOCKS,
  CRYPTO_QUOTE_ASSETS,
} = require("../../../src/services/symbolMappingService");

describe("symbolMappingService", () => {
  describe("parseProviderPrefix", () => {
    test("parses prefixed symbols into prefix, clean ticker, and raw value", () => {
      expect(parseProviderPrefix("FINNHUB:AAPL")).toEqual({
        prefix: "FINNHUB",
        clean: "AAPL",
        raw: "FINNHUB:AAPL",
      });
      expect(parseProviderPrefix("binance:btc/usdt")).toEqual({
        prefix: "BINANCE",
        clean: "BTC/USDT",
        raw: "BINANCE:BTC/USDT",
      });
      expect(parseProviderPrefix("  finnhub:xyzusdt  ")).toEqual({
        prefix: "FINNHUB",
        clean: "XYZUSDT",
        raw: "FINNHUB:XYZUSDT",
      });
    });

    test("handles non-prefixed symbols returning prefix: null", () => {
      expect(parseProviderPrefix("AAPL")).toEqual({
        prefix: null,
        clean: "AAPL",
        raw: "AAPL",
      });
      expect(parseProviderPrefix("BTCUSDT")).toEqual({
        prefix: null,
        clean: "BTCUSDT",
        raw: "BTCUSDT",
      });
    });

    test("rejects unsupported provider prefixes with 400", () => {
      expect(() => parseProviderPrefix("POLYGON:AAPL")).toThrow(
        "The symbol format is invalid.",
      );
      expect(() => parseProviderPrefix("UNKNOWN:BTCUSDT")).toThrow(
        "The symbol format is invalid.",
      );
      expect(() => parseProviderPrefix(":AAPL")).toThrow(
        "The symbol format is invalid.",
      );
    });

    test("rejects invalid characters with 400", () => {
      expect(() => parseProviderPrefix("AAPL$")).toThrow(
        "The symbol format is invalid.",
      );
      expect(() => parseProviderPrefix("")).toThrow("A symbol is required.");
    });
  });
  describe("normalizeSymbol", () => {
    test("normalizes a valid symbol to trimmed uppercase", () => {
      expect(normalizeSymbol("  aapl  ")).toBe("AAPL");
      expect(normalizeSymbol("btcusdt")).toBe("BTCUSDT");
      expect(normalizeSymbol("binance:btc/usdt")).toBe("BINANCE:BTC/USDT");
    });

    test("rejects non-string or whitespace-only inputs", () => {
      expect(() => normalizeSymbol("")).toThrow("A symbol is required.");
      expect(() => normalizeSymbol("   ")).toThrow("A symbol is required.");
      expect(() => normalizeSymbol(null)).toThrow("A symbol is required.");
      expect(() => normalizeSymbol(undefined)).toThrow("A symbol is required.");
      expect(() => normalizeSymbol(123)).toThrow("A symbol is required.");
    });

    test("rejects symbols containing invalid characters", () => {
      expect(() => normalizeSymbol("AAPL$")).toThrow("The symbol format is invalid.");
      expect(() => normalizeSymbol("BTC@USDT")).toThrow("The symbol format is invalid.");
      expect(() => normalizeSymbol("BTC USDT")).toThrow("The symbol format is invalid.");
    });

    test("rejects conflicting provider prefixes that contradict instrument syntax", () => {
      expect(() => normalizeSymbol("FINNHUB:BTCUSDT")).toThrow(
        "A valid stock ticker symbol is required.",
      );
      expect(() => normalizeSymbol("FINNHUB:BTC/USDT")).toThrow(
        "A valid stock ticker symbol is required.",
      );
      expect(() => normalizeSymbol("BINANCE:AAPL")).toThrow(
        "The cryptocurrency symbol format is invalid.",
      );
      expect(() => normalizeSymbol("BINANCE:GBTC")).toThrow(
        "The cryptocurrency symbol format is invalid.",
      );
    });
  });

  describe("inferAssetClass", () => {
    test("infers STOCK for standard equity tickers", () => {
      expect(inferAssetClass("AAPL")).toBe("STOCK");
      expect(inferAssetClass("MSFT")).toBe("STOCK");
      expect(inferAssetClass("BRK.B")).toBe("STOCK");
      expect(inferAssetClass("GOOGL")).toBe("STOCK");
    });

    test("does not misclassify stock tickers ending in crypto quote assets", () => {
      expect(inferAssetClass("GBTC")).toBe("STOCK");
      expect(inferAssetClass("METH")).toBe("STOCK");
      expect(inferAssetClass("SOL")).toBe("STOCK");
      expect(inferAssetClass("COIN")).toBe("STOCK");
      expect(inferAssetClass("RIOT")).toBe("STOCK");
      expect(inferAssetClass("BITO")).toBe("STOCK");
      expect(inferAssetClass("ETHE")).toBe("STOCK");
    });

    test("infers CRYPTO for BINANCE prefix and crypto pairs", () => {
      expect(inferAssetClass("BINANCE:BTCUSDT")).toBe("CRYPTO");
      expect(inferAssetClass("BINANCE:ETHBTC")).toBe("CRYPTO");
      expect(inferAssetClass("BTCUSDT")).toBe("CRYPTO");
      expect(inferAssetClass("ETHBTC")).toBe("CRYPTO");
      expect(inferAssetClass("SOLUSDT")).toBe("CRYPTO");
      expect(inferAssetClass("BTC/USDT")).toBe("CRYPTO");
      expect(inferAssetClass("ETH/BTC")).toBe("CRYPTO");
      expect(inferAssetClass("HYPERUSDC")).toBe("CRYPTO");
      expect(inferAssetClass("HYPERFDUSD")).toBe("CRYPTO");
      expect(inferAssetClass("HYPERTUSD")).toBe("CRYPTO");
      expect(inferAssetClass("HYPERBUSD")).toBe("CRYPTO");
      expect(inferAssetClass("HYPERTRY")).toBe("CRYPTO");
      expect(inferAssetClass("HYPEREUR")).toBe("CRYPTO");
      expect(inferAssetClass("1000SATSUSDT")).toBe("CRYPTO");
    });

    test("infers STOCK for FINNHUB prefix", () => {
      expect(inferAssetClass("FINNHUB:AAPL")).toBe("STOCK");
    });
  });

  describe("normalizeAssetClass", () => {
    test("accepts valid explicit asset classes", () => {
      expect(normalizeAssetClass("STOCK", "ETH")).toBe("STOCK");
      expect(normalizeAssetClass("CRYPTO", "WBTC")).toBe("CRYPTO");
      expect(normalizeAssetClass("stock", "aapl")).toBe("STOCK");
      expect(normalizeAssetClass("crypto", "btcusdt")).toBe("CRYPTO");
    });

    test("infers asset class when omitted", () => {
      expect(normalizeAssetClass(undefined, "AAPL")).toBe("STOCK");
      expect(normalizeAssetClass(null, "BTCUSDT")).toBe("CRYPTO");
      expect(normalizeAssetClass("", "BTC/USDT")).toBe("CRYPTO");
    });

    test("rejects unsupported asset classes with 422", () => {
      expect(() => normalizeAssetClass("FOREX", "EURUSD")).toThrow(
        "Market data is not supported for this asset class.",
      );
      expect(() => normalizeAssetClass("COMMODITY", "GOLD")).toThrow(
        "Market data is not supported for this asset class.",
      );
    });

    test("rejects conflicting explicit asset classes against prefixes, pairs, and slash syntax", () => {
      expect(() => normalizeAssetClass("CRYPTO", "FINNHUB:AAPL")).toThrow(
        "Market data is not supported for this asset class.",
      );
      expect(() => normalizeAssetClass("STOCK", "BINANCE:BTCUSDT")).toThrow(
        "Market data is not supported for this asset class.",
      );
      expect(() => normalizeAssetClass("STOCK", "BTC/USDT")).toThrow(
        "Market data is not supported for this asset class.",
      );
      expect(() => normalizeAssetClass("STOCK", "BTCUSDT")).toThrow(
        "Market data is not supported for this asset class.",
      );
      expect(() => normalizeAssetClass("STOCK", "ETHBTC")).toThrow(
        "Market data is not supported for this asset class.",
      );
    });
  });

  describe("toCanonicalSymbol", () => {
    test("strips provider prefixes", () => {
      expect(toCanonicalSymbol("BINANCE:BTCUSDT")).toBe("BTCUSDT");
      expect(toCanonicalSymbol("FINNHUB:AAPL")).toBe("AAPL");
    });

    test("converts crypto slash pairs into canonical concatenated symbols", () => {
      expect(toCanonicalSymbol("BTC/USDT")).toBe("BTCUSDT");
      expect(toCanonicalSymbol("BINANCE:BTC/USDT")).toBe("BTCUSDT");
      expect(toCanonicalSymbol("ETH/BTC")).toBe("ETHBTC");
      expect(toCanonicalSymbol("SOL/ETH")).toBe("SOLETH");
    });

    test("preserves stock tickers and delimited share classes", () => {
      expect(toCanonicalSymbol("AAPL")).toBe("AAPL");
      expect(toCanonicalSymbol("BRK.B")).toBe("BRK.B");
      expect(toCanonicalSymbol("BF.B")).toBe("BF.B");
    });

    test("rejects conflicting prefixes or unambiguous crypto pairs with incompatible explicit asset class", () => {
      expect(() =>
        toCanonicalSymbol("FINNHUB:AAPL", { assetClass: "CRYPTO" }),
      ).toThrow("Market data is not supported for this asset class.");
      expect(() =>
        toCanonicalSymbol("BINANCE:BTCUSDT", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");
      expect(() =>
        toCanonicalSymbol("BTC/USDT", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");
      expect(() =>
        toCanonicalSymbol("BTCUSDT", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");
      expect(() =>
        toCanonicalSymbol("ETHBTC", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");
    });
  });

  describe("toProviderSymbol", () => {
    describe("binance provider", () => {
      test("formats canonical crypto pairs for Binance REST/WebSocket", () => {
        expect(toProviderSymbol("BTCUSDT", "binance")).toBe("BTCUSDT");
        expect(toProviderSymbol("BINANCE:BTCUSDT", "binance")).toBe("BTCUSDT");
        expect(toProviderSymbol("BTC/USDT", "binance")).toBe("BTCUSDT");
        expect(toProviderSymbol("ETHBTC", "binance")).toBe("ETHBTC");
        expect(toProviderSymbol("HYPER/USDC", "binance")).toBe("HYPERUSDC");
        expect(toProviderSymbol("HYPERFDUSD", "binance")).toBe("HYPERFDUSD");
      });

      test("rejects stock symbols for Binance with 400", () => {
        expect(() => toProviderSymbol("AAPL", "binance")).toThrow(
          "The cryptocurrency symbol format is invalid.",
        );
      });

      test("rejects unsupported quote assets for Binance with 400", () => {
        expect(() => toProviderSymbol("BTCUSD", "binance")).toThrow(
          "The cryptocurrency symbol format is invalid.",
        );
      });

      test("rejects non-crypto explicit asset class with 422", () => {
        expect(() =>
          toProviderSymbol("BTCUSDT", "binance", { assetClass: "STOCK" }),
        ).toThrow("Market data is not supported for this asset class.");
      });
    });

    describe("finnhub provider", () => {
      test("formats stock tickers for Finnhub", () => {
        expect(toProviderSymbol("AAPL", "finnhub")).toBe("AAPL");
        expect(toProviderSymbol("FINNHUB:AAPL", "finnhub")).toBe("AAPL");
        expect(toProviderSymbol("BRK.B", "finnhub")).toBe("BRK.B");
        expect(toProviderSymbol("NOT_A_SYMBOL", "finnhub")).toBe("NOT_A_SYMBOL");
      });

      test("rejects non-stock explicit asset class with 422", () => {
        expect(() =>
          toProviderSymbol("AAPL", "finnhub", { assetClass: "CRYPTO" }),
        ).toThrow("Market data is not supported for this asset class.");
      });
    });

    test("throws 503 for unknown or unsupported providers", () => {
      expect(() => toProviderSymbol("AAPL", "polygon")).toThrow(
        "The configured market-data provider is unavailable.",
      );
    });
  });

  describe("toDisplaySymbol", () => {
    test("formats crypto symbols as base/quote pairs", () => {
      expect(toDisplaySymbol("BTCUSDT")).toBe("BTC/USDT");
      expect(toDisplaySymbol("ETHBTC")).toBe("ETH/BTC");
      expect(toDisplaySymbol("SOLUSDT")).toBe("SOL/USDT");
      expect(toDisplaySymbol("HYPERUSDC")).toBe("HYPER/USDC");
      expect(toDisplaySymbol("HYPERFDUSD")).toBe("HYPER/FDUSD");
    });

    test("preserves stock tickers for display", () => {
      expect(toDisplaySymbol("AAPL")).toBe("AAPL");
      expect(toDisplaySymbol("GBTC")).toBe("GBTC");
      expect(toDisplaySymbol("BRK.B")).toBe("BRK.B");
    });
  });

  describe("parseSymbol", () => {
    test("parses crypto symbols with rich metadata", () => {
      const parsed = parseSymbol("BINANCE:BTC/USDT");
      expect(parsed).toEqual({
        rawSymbol: "BINANCE:BTC/USDT",
        canonicalSymbol: "BTCUSDT",
        providerSymbol: "BTCUSDT",
        displaySymbol: "BTC/USDT",
        assetClass: "CRYPTO",
        provider: "binance",
        exchange: "BINANCE",
        baseAsset: "BTC",
        quoteAsset: "USDT",
      });
    });

    test("parses stock symbols with rich metadata", () => {
      const parsed = parseSymbol("AAPL");
      expect(parsed).toEqual({
        rawSymbol: "AAPL",
        canonicalSymbol: "AAPL",
        providerSymbol: "AAPL",
        displaySymbol: "AAPL",
        assetClass: "STOCK",
        provider: "finnhub",
        exchange: "FINNHUB",
        baseAsset: "AAPL",
        quoteAsset: "USD",
      });
    });
  });

  describe("resolveSymbol with PostgreSQL Prisma integration", () => {
    const mockPrisma = {
      symbol: {
        findUnique: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("resolves an active symbol from the database", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValueOnce({
        id: "sym-1",
        symbol: "AAPL",
        name: "Apple Inc.",
        assetType: "STOCK",
        exchange: "NASDAQ",
        currency: "USD",
        isActive: true,
        isTradable: true,
        sector: "Technology",
        industry: "Consumer Electronics",
        logoUrl: "https://example.com/logo.png",
        description: "Apple designs consumer electronics.",
      });

      const result = await resolveSymbol("aapl", { prisma: mockPrisma });

      expect(mockPrisma.symbol.findUnique).toHaveBeenCalledWith({
        where: { symbol: "AAPL" },
      });
      expect(result).toMatchObject({
        canonicalSymbol: "AAPL",
        assetClass: "STOCK",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        isActive: true,
        isTradable: true,
        provider: "finnhub",
        providerSymbol: "AAPL",
        displaySymbol: "AAPL",
        source: "database",
      });
    });

    test("throws ASSET_TYPE_MISMATCH when requested asset class conflicts with DB", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValueOnce({
        id: "sym-1",
        symbol: "AAPL",
        name: "Apple Inc.",
        assetType: "STOCK",
        isActive: true,
      });

      await expect(
        resolveSymbol("AAPL", { prisma: mockPrisma, assetClass: "CRYPTO" }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "ASSET_TYPE_MISMATCH",
        message: "Asset type does not match the selected symbol.",
      });
    });

    test("throws SYMBOL_NOT_FOUND when DB symbol is inactive unless includeInactive", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValue({
        id: "sym-2",
        symbol: "OLDTICKER",
        name: "Old Ticker Inc.",
        assetType: "STOCK",
        isActive: false,
      });

      await expect(
        resolveSymbol("OLDTICKER", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "SYMBOL_NOT_FOUND",
      });

      const allowed = await resolveSymbol("OLDTICKER", {
        prisma: mockPrisma,
        includeInactive: true,
      });
      expect(allowed.canonicalSymbol).toBe("OLDTICKER");
      expect(allowed.isActive).toBe(false);
    });

    test("throws SYMBOL_NOT_FOUND when symbol is missing in DB and strict: true", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValueOnce(null);

      await expect(
        resolveSymbol("UNKNOWN_SYM", { prisma: mockPrisma, strict: true }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "SYMBOL_NOT_FOUND",
      });
    });

    test("falls back to rule-based resolution when symbol is missing in DB and strict: false", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValueOnce(null);

      const result = await resolveSymbol("BTCUSDT", { prisma: mockPrisma });

      expect(result).toMatchObject({
        canonicalSymbol: "BTCUSDT",
        assetClass: "CRYPTO",
        provider: "binance",
        providerSymbol: "BTCUSDT",
        displaySymbol: "BTC/USDT",
        source: "rule",
      });
    });

    test("throws DATABASE_ERROR (500) when database query rejects with an error", async () => {
      mockPrisma.symbol.findUnique.mockRejectedValueOnce(
        new Error("Database connection timeout"),
      );

      await expect(
        resolveSymbol("AAPL", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
        message: "Symbol resolution failed due to a database error.",
      });
    });

    test("propagates AppError directly if thrown by database layer", async () => {
      const { AppError } = require("../../../src/utils/errors");
      mockPrisma.symbol.findUnique.mockRejectedValueOnce(
        new AppError("Custom database error", { statusCode: 503, code: "DB_DOWN" }),
      );

      await expect(
        resolveSymbol("AAPL", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "DB_DOWN",
        message: "Custom database error",
      });
    });

    test("permits fallback on error only when allowFallbackOnError is true", async () => {
      mockPrisma.symbol.findUnique.mockRejectedValueOnce(
        new Error("Database connection timeout"),
      );

      const result = await resolveSymbol("BTCUSDT", {
        prisma: mockPrisma,
        allowFallbackOnError: true,
      });

      expect(result.source).toBe("rule");
      expect(result.assetClass).toBe("CRYPTO");
    });

    test("resolves multiple symbols in batch", async () => {
      mockPrisma.symbol.findUnique
        .mockResolvedValueOnce({
          id: "sym-1",
          symbol: "AAPL",
          name: "Apple Inc.",
          assetType: "STOCK",
          isActive: true,
        })
        .mockResolvedValueOnce(null);

      const results = await resolveSymbols(["AAPL", "BTC/USDT"], {
        prisma: mockPrisma,
      });

      expect(results).toHaveLength(2);
      expect(results[0].canonicalSymbol).toBe("AAPL");
      expect(results[0].source).toBe("database");
      expect(results[1].canonicalSymbol).toBe("BTCUSDT");
      expect(results[1].source).toBe("rule");
    });
  });
});
