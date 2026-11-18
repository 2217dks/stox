const {
  resolveSymbol,
  toProviderSymbol,
  toCanonicalSymbol,
  normalizeSymbol,
  normalizeAssetClass,
} = require("../../../src/services/symbolMappingService");
const {
  createMarketDataService,
} = require("../../../src/services/marketDataService");

describe("Symbol Resolution & Mapping Regression Suite", () => {
  let mockPrisma;
  let mockStockProvider;
  let mockCryptoProvider;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      symbol: {
        findUnique: jest.fn(),
      },
    };

    mockStockProvider = {
      getQuote: jest.fn(async (symbol) => ({
        symbol,
        assetClass: "STOCK",
        price: "150.00",
        change: "2.50",
        changePercent: "1.69",
        high: "152.00",
        low: "148.00",
        open: "149.00",
        previousClose: "147.50",
        volume: "50000",
        currency: "USD",
        timestamp: "2026-11-02T00:00:00.000Z",
        source: "mock-stock",
      })),
      getHistoricalPrices: jest.fn(async (symbol, options) => ({
        symbol,
        assetClass: "STOCK",
        interval: options.interval,
        prices: [
          {
            timestamp: "2026-11-01T00:00:00.000Z",
            open: "148.00",
            high: "152.00",
            low: "147.00",
            close: "150.00",
            volume: "50000",
          },
        ],
      })),
    };

    mockCryptoProvider = {
      getQuote: jest.fn(async (symbol) => ({
        symbol,
        assetClass: "CRYPTO",
        price: "60000.00",
        change: "1200.00",
        changePercent: "2.04",
        high: "61000.00",
        low: "59000.00",
        open: "59500.00",
        previousClose: "58800.00",
        volume: "1200",
        currency: "USDT",
        timestamp: "2026-11-02T00:00:00.000Z",
        source: "mock-crypto",
      })),
      getHistoricalPrices: jest.fn(async (symbol, options) => ({
        symbol,
        assetClass: "CRYPTO",
        interval: options.interval,
        prices: [
          {
            timestamp: "2026-11-01T00:00:00.000Z",
            open: "59000.00",
            high: "61000.00",
            low: "58500.00",
            close: "60000.00",
            volume: "1200",
          },
        ],
      })),
    };

    service = createMarketDataService({
      config: {
        providerByAssetClass: { STOCK: "mock-stock", CRYPTO: "mock-crypto" },
        timeoutMs: 5000,
      },
      providers: {
        "mock-stock": mockStockProvider,
        "mock-crypto": mockCryptoProvider,
      },
    });
  });

  describe("Item 1 & 4: Cross-Path Resolution & Caller Alignment", () => {
    test("resolves BTC/USDT consistently across getQuote, getHistoricalPrices, and toProviderSymbol", async () => {
      const resolved = await resolveSymbol("BTC/USDT");
      expect(resolved.canonicalSymbol).toBe("BTCUSDT");
      expect(resolved.assetClass).toBe("CRYPTO");
      expect(resolved.providerSymbol).toBe("BTCUSDT");

      const providerSym = toProviderSymbol("BTC/USDT", "binance");
      expect(providerSym).toBe("BTCUSDT");

      const quote = await service.getQuote("BTC/USDT");
      expect(mockCryptoProvider.getQuote).toHaveBeenCalledWith("BTCUSDT");
      expect(quote.assetClass).toBe("CRYPTO");

      const history = await service.getHistoricalPrices("BTC/USDT", {
        interval: "1d",
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        limit: 10,
      });
      expect(mockCryptoProvider.getHistoricalPrices).toHaveBeenCalledWith(
        "BTCUSDT",
        expect.objectContaining({ interval: "1d" }),
      );
      expect(history.symbol).toBe("BTCUSDT");
      expect(history.assetClass).toBe("CRYPTO");
    });

    test("resolves prefixed BINANCE:BTCUSDT consistently across getQuote and getHistoricalPrices", async () => {
      const quote = await service.getQuote("BINANCE:BTCUSDT");
      expect(mockCryptoProvider.getQuote).toHaveBeenCalledWith("BTCUSDT");
      expect(quote.assetClass).toBe("CRYPTO");

      const history = await service.getHistoricalPrices("BINANCE:BTCUSDT", {
        interval: "1d",
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        limit: 10,
      });
      expect(mockCryptoProvider.getHistoricalPrices).toHaveBeenCalledWith(
        "BTCUSDT",
        expect.objectContaining({ interval: "1d" }),
      );
      expect(history.symbol).toBe("BTCUSDT");
    });

    test("resolves stock ticker AAPL consistently across getQuote and getHistoricalPrices", async () => {
      const resolved = await resolveSymbol("aapl");
      expect(resolved.canonicalSymbol).toBe("AAPL");
      expect(resolved.assetClass).toBe("STOCK");
      expect(resolved.providerSymbol).toBe("AAPL");

      const quote = await service.getQuote("aapl");
      expect(mockStockProvider.getQuote).toHaveBeenCalledWith("AAPL");
      expect(quote.assetClass).toBe("STOCK");

      const history = await service.getHistoricalPrices("aapl", {
        interval: "1d",
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        limit: 10,
      });
      expect(mockStockProvider.getHistoricalPrices).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1d" }),
      );
      expect(history.symbol).toBe("AAPL");
    });
  });

  describe("Item 2: Conflicting Prefixes and Explicit Asset Classes", () => {
    test("rejects FINNHUB prefix with crypto pair (FINNHUB:BTCUSDT) across all entry points", async () => {
      expect(() => normalizeSymbol("FINNHUB:BTCUSDT")).toThrow(
        "A valid stock ticker symbol is required.",
      );
      expect(() => toCanonicalSymbol("FINNHUB:BTCUSDT")).toThrow(
        "A valid stock ticker symbol is required.",
      );
      await expect(resolveSymbol("FINNHUB:BTCUSDT")).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
      await expect(service.getQuote("FINNHUB:BTCUSDT")).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
      await expect(
        service.getHistoricalPrices("FINNHUB:BTCUSDT", {
          interval: "1d",
          from: 1_700_000_000_000,
          to: 1_700_086_400_000,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
    });

    test("rejects BINANCE prefix with stock ticker (BINANCE:AAPL) across all entry points", async () => {
      expect(() => normalizeSymbol("BINANCE:AAPL")).toThrow(
        "The cryptocurrency symbol format is invalid.",
      );
      expect(() => toCanonicalSymbol("BINANCE:AAPL")).toThrow(
        "The cryptocurrency symbol format is invalid.",
      );
      await expect(resolveSymbol("BINANCE:AAPL")).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
      await expect(service.getQuote("BINANCE:AAPL")).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
      await expect(
        service.getHistoricalPrices("BINANCE:AAPL", {
          interval: "1d",
          from: 1_700_000_000_000,
          to: 1_700_086_400_000,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
    });

    test("rejects slash-form symbols with conflicting STOCK asset class (BTC/USDT with assetClass: 'STOCK')", async () => {
      expect(() =>
        normalizeAssetClass("STOCK", "BTC/USDT"),
      ).toThrow("Market data is not supported for this asset class.");

      expect(() =>
        toCanonicalSymbol("BTC/USDT", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");

      await expect(
        resolveSymbol("BTC/USDT", { assetClass: "STOCK" }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      });

      await expect(
        service.getQuote("BTC/USDT", { assetClass: "STOCK" }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      });
    });

    test("rejects FINNHUB prefix with explicit CRYPTO asset class", async () => {
      expect(() =>
        normalizeAssetClass("CRYPTO", "FINNHUB:AAPL"),
      ).toThrow("Market data is not supported for this asset class.");

      expect(() =>
        toCanonicalSymbol("FINNHUB:AAPL", { assetClass: "CRYPTO" }),
      ).toThrow("Market data is not supported for this asset class.");

      await expect(
        resolveSymbol("FINNHUB:AAPL", { assetClass: "CRYPTO" }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      });
    });

    test("rejects BINANCE prefix with explicit STOCK asset class", async () => {
      expect(() =>
        normalizeAssetClass("STOCK", "BINANCE:BTCUSDT"),
      ).toThrow("Market data is not supported for this asset class.");

      expect(() =>
        toCanonicalSymbol("BINANCE:BTCUSDT", { assetClass: "STOCK" }),
      ).toThrow("Market data is not supported for this asset class.");

      await expect(
        resolveSymbol("BINANCE:BTCUSDT", { assetClass: "STOCK" }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      });
    });
  });

  describe("Item 3: Database Metadata Precedence, Inactive & Unknown Symbols", () => {
    test("rejects inactive database symbols with 404 SYMBOL_NOT_FOUND unless includeInactive is set", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValue({
        id: "sym-inactive",
        symbol: "DELISTED",
        name: "Delisted Stock Inc.",
        assetType: "STOCK",
        isActive: false,
      });

      await expect(
        resolveSymbol("DELISTED", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "SYMBOL_NOT_FOUND",
      });

      await expect(
        service.getQuote("DELISTED", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "SYMBOL_NOT_FOUND",
      });

      const allowed = await resolveSymbol("DELISTED", {
        prisma: mockPrisma,
        includeInactive: true,
      });
      expect(allowed.canonicalSymbol).toBe("DELISTED");
      expect(allowed.isActive).toBe(false);
    });

    test("handles unknown symbols: strict returns 404 SYMBOL_NOT_FOUND, non-strict falls back to rule", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValue(null);

      await expect(
        resolveSymbol("UNLISTED_TICKER", { prisma: mockPrisma, strict: true }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "SYMBOL_NOT_FOUND",
      });

      const fallback = await resolveSymbol("UNLISTED_TICKER", {
        prisma: mockPrisma,
        strict: false,
      });
      expect(fallback.source).toBe("rule");
      expect(fallback.canonicalSymbol).toBe("UNLISTED_TICKER");
      expect(fallback.assetClass).toBe("STOCK");
    });

    test("rejects explicit asset-class mismatch against database record with 400 ASSET_TYPE_MISMATCH", async () => {
      mockPrisma.symbol.findUnique.mockResolvedValue({
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
      });

      await expect(
        service.getQuote("AAPL", { prisma: mockPrisma, assetClass: "CRYPTO" }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "ASSET_TYPE_MISMATCH",
      });
    });

    test("database metadata takes precedence when syntax-based inference conflicts (XYZUSDT as STOCK)", async () => {
      // By syntax alone, XYZUSDT ends in USDT and would be inferred as CRYPTO.
      // But database record explicitly registers XYZUSDT as a STOCK.
      mockPrisma.symbol.findUnique.mockResolvedValue({
        id: "sym-special-stock",
        symbol: "XYZUSDT",
        name: "XYZ Holdings Inc.",
        assetType: "STOCK",
        exchange: "NYSE",
        currency: "USD",
        isActive: true,
      });

      const resolved = await resolveSymbol("XYZUSDT", { prisma: mockPrisma });
      expect(resolved.source).toBe("database");
      expect(resolved.assetClass).toBe("STOCK");
      expect(resolved.provider).toBe("finnhub");
      expect(resolved.providerSymbol).toBe("XYZUSDT");

      const quote = await service.getQuote("XYZUSDT", { prisma: mockPrisma });
      // Must dispatch to stock provider, NOT crypto provider!
      expect(mockStockProvider.getQuote).toHaveBeenCalledWith("XYZUSDT");
      expect(mockCryptoProvider.getQuote).not.toHaveBeenCalled();
      expect(quote.assetClass).toBe("STOCK");
    });

    test("database metadata takes precedence when syntax-based inference conflicts (ETH single-token as CRYPTO)", async () => {
      // By syntax alone, ETH is not a base/quote pair and would be inferred as STOCK.
      // But database record registers ETH as CRYPTO.
      mockPrisma.symbol.findUnique.mockResolvedValue({
        id: "sym-eth",
        symbol: "ETH",
        name: "Ethereum",
        assetType: "CRYPTO",
        exchange: "BINANCE",
        currency: "USD",
        isActive: true,
      });

      const resolved = await resolveSymbol("ETH", { prisma: mockPrisma });
      expect(resolved.source).toBe("database");
      expect(resolved.assetClass).toBe("CRYPTO");
      expect(resolved.provider).toBe("binance");
      expect(resolved.providerSymbol).toBe("ETHUSDT");

      const quote = await service.getQuote("ETH", { prisma: mockPrisma });
      // Must dispatch to crypto provider, NOT stock provider!
      expect(mockCryptoProvider.getQuote).toHaveBeenCalledWith("ETHUSDT");
      expect(mockStockProvider.getQuote).not.toHaveBeenCalled();
      expect(quote.assetClass).toBe("CRYPTO");
    });
  });

  describe("Item 4: Database Resolution Failure Handling", () => {
    test("rejects with DATABASE_ERROR when findUnique fails with connection error and does not silently fall back (ETH)", async () => {
      mockPrisma.symbol.findUnique.mockRejectedValue(
        new Error("Connection to PostgreSQL failed: ECONNREFUSED"),
      );

      // resolveSymbol must throw DATABASE_ERROR rather than silently falling back to STOCK
      await expect(
        resolveSymbol("ETH", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
        message: "Symbol resolution failed due to a database error.",
      });

      // getQuote must propagate resolution error and not dispatch to Finnhub/stock provider
      await expect(
        service.getQuote("ETH", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
      });
      expect(mockStockProvider.getQuote).not.toHaveBeenCalled();
      expect(mockCryptoProvider.getQuote).not.toHaveBeenCalled();

      // getHistoricalPrices must also propagate resolution error
      await expect(
        service.getHistoricalPrices("ETH", {
          prisma: mockPrisma,
          interval: "1d",
          from: 1_700_000_000_000,
          to: 1_700_086_400_000,
          limit: 10,
        }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
      });
      expect(mockStockProvider.getHistoricalPrices).not.toHaveBeenCalled();
      expect(mockCryptoProvider.getHistoricalPrices).not.toHaveBeenCalled();
    });

    test("rejects with DATABASE_ERROR when findUnique fails with query error for a registered stock ending in USDT (XYZUSDT)", async () => {
      mockPrisma.symbol.findUnique.mockRejectedValue(
        new Error("Query failed: table 'Symbol' does not exist"),
      );

      // Must not silently fall back to CRYPTO based on USDT suffix!
      await expect(
        resolveSymbol("XYZUSDT", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
      });

      await expect(
        service.getQuote("XYZUSDT", { prisma: mockPrisma }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "DATABASE_ERROR",
      });
      expect(mockCryptoProvider.getQuote).not.toHaveBeenCalled();
      expect(mockStockProvider.getQuote).not.toHaveBeenCalled();
    });

    test("allows explicit opt-in fallback when allowFallbackOnError: true is set", async () => {
      mockPrisma.symbol.findUnique.mockRejectedValue(
        new Error("Temporary DB glitch"),
      );

      const resolved = await resolveSymbol("BTCUSDT", {
        prisma: mockPrisma,
        allowFallbackOnError: true,
      });
      expect(resolved.source).toBe("rule");
      expect(resolved.assetClass).toBe("CRYPTO");
      expect(resolved.canonicalSymbol).toBe("BTCUSDT");
    });
  });
});
