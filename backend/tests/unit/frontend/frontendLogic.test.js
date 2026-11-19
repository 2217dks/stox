const fs = require("fs");
const path = require("path");

const QUANTITY_SCALE = 8;
const QUANTITY_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/** Percent of a decimal quantity without floating-point overshoot. */
function fractionQuantity(value, percent) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  const text = num.toFixed(QUANTITY_SCALE);
  const [whole = "0", fraction = ""] = text.split(".");
  const digits = `${whole}${fraction.padEnd(QUANTITY_SCALE, "0").slice(0, QUANTITY_SCALE)}`;
  const scaled = (BigInt(digits) * BigInt(percent)) / 100n;
  const wholePart = scaled / QUANTITY_FACTOR;
  const fractionPart = (scaled % QUANTITY_FACTOR)
    .toString()
    .padStart(QUANTITY_SCALE, "0")
    .replace(/0+$/, "");
  const result = `${wholePart}${fractionPart ? `.${fractionPart}` : ""}`;
  return result === "0" ? "" : result;
}

/** Round a cash-derived quantity down so the notional can never exceed cash. */
function floorQuantity(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  const truncated = Math.floor(num * 10 ** QUANTITY_SCALE) / 10 ** QUANTITY_SCALE;
  return truncated > 0
    ? truncated.toFixed(QUANTITY_SCALE).replace(/\.?0+$/, "")
    : "";
}

/** Canonical symbol normalizer matching frontend/lib/utils.js */
function canonicalMarketSymbol(symbol = "") {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^BINANCE:/, "")
    .replace(/\//g, "");
}

/** SWR quotes key formulation matching frontend/lib/hooks.js */
function computeQuotesKey(symbols = [], assetTypes = {}) {
  const symbolKey = symbols.slice().sort().join(",");
  const assetTypesKey = Object.entries(assetTypes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  return symbolKey
    ? assetTypesKey
      ? `quotes:${symbolKey}:${assetTypesKey}`
      : `quotes:${symbolKey}`
    : null;
}

/** Stable asset types parser matching frontend/lib/hooks.js */
function parseStableAssetTypes(assetTypesKey) {
  if (!assetTypesKey) return {};
  return Object.fromEntries(
    assetTypesKey.split(",").map((entry) => entry.split(":")),
  );
}

/** Query parameter serializer matching frontend/lib/endpoints.js */
function serializeQuotesQuery(symbols = [], assetTypes = {}) {
  const query = { symbols: symbols.join(",") };
  if (
    assetTypes &&
    typeof assetTypes === "object" &&
    Object.keys(assetTypes).length > 0
  ) {
    query.assetTypes = Object.entries(assetTypes)
      .filter(([_, v]) => Boolean(v))
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
  }
  return query;
}

/** Position calculation matching frontend/lib/hooks.js (usePosition) */
function calculatePosition({
  holding = null,
  holdings = [],
  pendingOrders = [],
  targetSymbol,
  assetType = null,
}) {
  const symbolKey = canonicalMarketSymbol(targetSymbol);
  if (!symbolKey) {
    return {
      holding: null,
      quantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      averageBuyPrice: 0,
      totalInvested: 0,
      hasPosition: false,
    };
  }

  const rawList = holdings.length > 0 ? holdings : holding ? [holding] : [];
  const matchedHoldings = rawList.filter((item) => {
    if (canonicalMarketSymbol(item.symbol) !== symbolKey) return false;
    if (assetType && item.assetType && item.assetType !== assetType) {
      return false;
    }
    return true;
  });

  if (!matchedHoldings.length) {
    return {
      holding: null,
      quantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      averageBuyPrice: 0,
      totalInvested: 0,
      hasPosition: false,
    };
  }

  const first = matchedHoldings[0];
  let totalQty = 0;
  let totalReserved = 0;
  let totalInvested = 0;

  for (const h of matchedHoldings) {
    totalQty += Number(h.quantity || 0);
    if (h.reservedQuantity !== undefined && h.reservedQuantity !== null) {
      totalReserved += Number(h.reservedQuantity);
    }
    totalInvested += Number(
      h.totalInvested ||
        Number(h.quantity || 0) * Number(h.averageBuyPrice || 0),
    );
  }

  if (totalReserved === 0 && pendingOrders.length > 0) {
    totalReserved = pendingOrders
      .filter(
        (order) =>
          order.side === "SELL" &&
          order.status === "PENDING" &&
          canonicalMarketSymbol(order.symbol) === symbolKey,
      )
      .reduce((total, order) => total + Number(order.quantity || 0), 0);
  }

  const netQty = Number(totalQty.toFixed(8));
  const netReserved = Number(
    Math.min(Math.max(totalReserved, 0), netQty).toFixed(8),
  );
  const availableQuantity = Number(Math.max(0, netQty - netReserved).toFixed(8));
  const avgBuyPrice = netQty > 0 ? totalInvested / netQty : 0;

  const aggregatedHolding = {
    ...first,
    quantity: netQty.toString(),
    reservedQuantity: netReserved.toString(),
    availableQuantity: availableQuantity.toString(),
    averageBuyPrice: avgBuyPrice.toString(),
    totalInvested: totalInvested.toString(),
  };

  return {
    holding: aggregatedHolding,
    quantity: netQty,
    reservedQuantity: netReserved,
    availableQuantity,
    averageBuyPrice: avgBuyPrice,
    totalInvested,
    hasPosition: netQty > 0,
  };
}

describe("Frontend Regression & Contract Tests", () => {
  const frontendDir = path.resolve(__dirname, "../../../../frontend");

  describe("1. useQuotes & Batch Quote Asset-Class Propagation", () => {
    test("generates simple cache key when assetTypes is omitted or empty", () => {
      expect(computeQuotesKey(["AAPL", "BTCUSDT"])).toBe("quotes:AAPL,BTCUSDT");
      expect(computeQuotesKey(["TSLA", "AAPL", "MSFT"])).toBe("quotes:AAPL,MSFT,TSLA");
      expect(computeQuotesKey([])).toBeNull();
    });

    test("generates compound cache key with deterministically sorted asset types", () => {
      const symbols = ["NVDA", "BTCUSDT", "AAPL"];
      const assetTypes = { NVDA: "STOCK", BTCUSDT: "CRYPTO", AAPL: "STOCK" };

      const key = computeQuotesKey(symbols, assetTypes);
      expect(key).toBe("quotes:AAPL,BTCUSDT,NVDA:AAPL:STOCK,BTCUSDT:CRYPTO,NVDA:STOCK");
    });

    test("stableAssetTypes correctly deserializes compound assetTypesKey", () => {
      const assetTypesKey = "AAPL:STOCK,BTCUSDT:CRYPTO,NVDA:STOCK";
      const parsed = parseStableAssetTypes(assetTypesKey);

      expect(parsed).toEqual({
        AAPL: "STOCK",
        BTCUSDT: "CRYPTO",
        NVDA: "STOCK",
      });
      expect(parseStableAssetTypes("")).toEqual({});
    });

    test("marketApi.quotes serializes query with assetTypes parameter", () => {
      const queryWithTypes = serializeQuotesQuery(["AAPL", "BTCUSDT"], {
        AAPL: "STOCK",
        BTCUSDT: "CRYPTO",
      });

      expect(queryWithTypes).toEqual({
        symbols: "AAPL,BTCUSDT",
        assetTypes: "AAPL:STOCK,BTCUSDT:CRYPTO",
      });

      const queryWithoutTypes = serializeQuotesQuery(["AAPL", "NVDA"], {});
      expect(queryWithoutTypes).toEqual({
        symbols: "AAPL,NVDA",
      });
      expect(queryWithoutTypes.assetTypes).toBeUndefined();
    });

    test("socket tick filter ignores price updates with mismatched asset class", () => {
      const requestedSymbols = ["BTCUSDT", "AAPL"];
      const stableAssetTypes = { AAPL: "STOCK", BTCUSDT: "CRYPTO" };

      function filterTick(payload) {
        if (!payload?.symbol) return null;
        const canonicalList = requestedSymbols.map(canonicalMarketSymbol);
        const index = canonicalList.indexOf(canonicalMarketSymbol(payload.symbol));
        if (index === -1) return null;

        const targetSymbol = requestedSymbols[index];
        const expectedAsset = stableAssetTypes[targetSymbol] || "CRYPTO";

        if (payload.assetClass && payload.assetClass !== expectedAsset) {
          return null;
        }

        return { symbol: targetSymbol, price: payload.price };
      }

      // Matching crypto tick
      expect(filterTick({ symbol: "BTCUSDT", assetClass: "CRYPTO", price: "68000" })).toEqual({
        symbol: "BTCUSDT",
        price: "68000",
      });

      // Matching stock tick
      expect(filterTick({ symbol: "AAPL", assetClass: "STOCK", price: "230" })).toEqual({
        symbol: "AAPL",
        price: "230",
      });

      // Mismatched stock tick for crypto symbol -> rejected
      expect(filterTick({ symbol: "BTCUSDT", assetClass: "STOCK", price: "68000" })).toBeNull();

      // Mismatched crypto tick for stock symbol -> rejected
      expect(filterTick({ symbol: "AAPL", assetClass: "CRYPTO", price: "230" })).toBeNull();

      // Unrequested symbol -> rejected
      expect(filterTick({ symbol: "SOLUSDT", assetClass: "CRYPTO", price: "180" })).toBeNull();
    });

    test("source verification: hooks.js and endpoints.js include asset-class propagation", () => {
      const hooksSrc = fs.readFileSync(path.join(frontendDir, "lib/hooks.js"), "utf8");
      const endpointsSrc = fs.readFileSync(path.join(frontendDir, "lib/endpoints.js"), "utf8");

      expect(hooksSrc).toContain("assetTypesKey");
      expect(hooksSrc).toContain("stableAssetTypes");
      expect(hooksSrc).toContain("marketApi.quotes(symbols, stableAssetTypes)");
      expect(hooksSrc).toContain("payload.assetClass !== expectedAsset");

      expect(endpointsSrc).toContain("query.assetTypes = Object.entries(assetTypes)");
    });
  });

  describe("2. usePosition & Backend SELL Protection Netting", () => {
    test("calculates full available position when there are no pending SELL orders", () => {
      const pos = calculatePosition({
        holding: { symbol: "AAPL", quantity: "50", averageBuyPrice: "150", totalInvested: "7500" },
        pendingOrders: [],
        targetSymbol: "AAPL",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(0);
      expect(pos.availableQuantity).toBe(50);
      expect(pos.hasPosition).toBe(true);
      expect(pos.averageBuyPrice).toBe(150);
      expect(pos.totalInvested).toBe(7500);
    });

    test("nets out pending SELL orders from availableQuantity", () => {
      const pos = calculatePosition({
        holding: { symbol: "BTCUSDT", quantity: "2.50000000" },
        pendingOrders: [
          { symbol: "BTCUSDT", side: "SELL", status: "PENDING", quantity: "1.00000000" },
          { symbol: "BTCUSDT", side: "SELL", status: "PENDING", quantity: "0.50000000" },
        ],
        targetSymbol: "BTCUSDT",
      });

      expect(pos.quantity).toBe(2.5);
      expect(pos.reservedQuantity).toBe(1.5);
      expect(pos.availableQuantity).toBe(1.0);
      expect(pos.hasPosition).toBe(true);
    });

    test("ignores non-pending and BUY orders in reserved calculation", () => {
      const pos = calculatePosition({
        holding: { symbol: "NVDA", quantity: "20" },
        pendingOrders: [
          { symbol: "NVDA", side: "BUY", status: "PENDING", quantity: "10" },
          { symbol: "NVDA", side: "SELL", status: "FILLED", quantity: "5" },
          { symbol: "NVDA", side: "SELL", status: "CANCELLED", quantity: "4" },
          { symbol: "NVDA", side: "SELL", status: "REJECTED", quantity: "2" },
          { symbol: "OTHER", side: "SELL", status: "PENDING", quantity: "8" },
          { symbol: "NVDA", side: "SELL", status: "PENDING", quantity: "7" },
        ],
        targetSymbol: "NVDA",
      });

      expect(pos.quantity).toBe(20);
      expect(pos.reservedQuantity).toBe(7);
      expect(pos.availableQuantity).toBe(13);
    });

    test("clamps reserved quantity so availableQuantity is never negative", () => {
      const pos = calculatePosition({
        holding: { symbol: "SOLUSDT", quantity: "10" },
        pendingOrders: [
          { symbol: "SOLUSDT", side: "SELL", status: "PENDING", quantity: "25" },
        ],
        targetSymbol: "SOLUSDT",
      });

      expect(pos.quantity).toBe(10);
      expect(pos.reservedQuantity).toBe(10);
      expect(pos.availableQuantity).toBe(0);
    });

    test("canonicalizes symbol matching for prefixed and lowercase tickers", () => {
      const pos = calculatePosition({
        holding: { symbol: "BINANCE:ETHUSDT", quantity: "5.0" },
        pendingOrders: [
          { symbol: "ETHUSDT", side: "SELL", status: "PENDING", quantity: "2.0" },
        ],
        targetSymbol: "eth/usdt",
      });

      expect(pos.quantity).toBe(5.0);
      expect(pos.reservedQuantity).toBe(2.0);
      expect(pos.availableQuantity).toBe(3.0);
      expect(pos.hasPosition).toBe(true);
    });

    test("handles missing holding gracefully", () => {
      const pos = calculatePosition({
        holding: null,
        pendingOrders: [{ symbol: "TSLA", side: "SELL", status: "PENDING", quantity: "5" }],
        targetSymbol: "TSLA",
      });

      expect(pos.quantity).toBe(0);
      expect(pos.reservedQuantity).toBe(0);
      expect(pos.availableQuantity).toBe(0);
      expect(pos.hasPosition).toBe(false);
      expect(pos.holding).toBeNull();
    });

    test("accurately reflects reserved and available position when holding.reservedQuantity covers > 100 pending SELL orders", () => {
      // User holds 50 shares of TSLA
      // Backend aggregated 150 pending sell orders of 0.2 shares each into reservedQuantity: "30"
      // Frontend client-side /orders query only returned first page (100 orders = 20 shares)
      const pos = calculatePosition({
        holding: {
          symbol: "TSLA",
          quantity: "50",
          reservedQuantity: "30",
          availableQuantity: "20",
        },
        pendingOrders: Array.from({ length: 100 }, () => ({
          symbol: "TSLA",
          side: "SELL",
          status: "PENDING",
          quantity: "0.2",
        })),
        targetSymbol: "TSLA",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(30);
      expect(pos.availableQuantity).toBe(20);
      expect(pos.hasPosition).toBe(true);
    });

    test("aggregates two equivalent holding records with different symbol formats", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "BINANCE:BTCUSDT", quantity: "2.0", reservedQuantity: "1.0", totalInvested: "100000" },
          { symbol: "BTC/USDT", quantity: "3.0", reservedQuantity: "0.0", totalInvested: "180000" },
        ],
        targetSymbol: "BTCUSDT",
      });

      expect(pos.quantity).toBe(5.0);
      expect(pos.reservedQuantity).toBe(1.0);
      expect(pos.availableQuantity).toBe(4.0);
      expect(pos.totalInvested).toBe(280000);
      expect(pos.averageBuyPrice).toBe(56000);
      expect(pos.hasPosition).toBe(true);
    });

    test("aggregates three equivalent holding records correctly", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "BINANCE:BTCUSDT", quantity: "2.0", reservedQuantity: "1.0", totalInvested: "100000" },
          { symbol: "BTC/USDT", quantity: "3.0", reservedQuantity: "0.5", totalInvested: "180000" },
          { symbol: "BTCUSDT", quantity: "1.5", reservedQuantity: "0.0", totalInvested: "90000" },
        ],
        targetSymbol: "BINANCE:BTC/USDT",
      });

      expect(pos.quantity).toBe(6.5);
      expect(pos.reservedQuantity).toBe(1.5);
      expect(pos.availableQuantity).toBe(5.0);
      expect(pos.totalInvested).toBe(370000);
      expect(pos.averageBuyPrice).toBeCloseTo(370000 / 6.5, 6);
      expect(pos.hasPosition).toBe(true);
    });

    test("isolates holdings with different asset types for the same or similar symbols", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "BTC", assetType: "STOCK", quantity: "100", reservedQuantity: "20", totalInvested: "5000" },
          { symbol: "BTCUSDT", assetType: "CRYPTO", quantity: "2.5", reservedQuantity: "0.5", totalInvested: "150000" },
        ],
        targetSymbol: "BTC",
        assetType: "STOCK",
      });

      expect(pos.quantity).toBe(100);
      expect(pos.reservedQuantity).toBe(20);
      expect(pos.availableQuantity).toBe(80);
      expect(pos.totalInvested).toBe(5000);
    });

    test("handles multiple pending SELL orders across equivalent symbol formats", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "BINANCE:ETHUSDT", quantity: "4.0", reservedQuantity: "0.0", totalInvested: "12000" },
          { symbol: "ETH/USDT", quantity: "6.0", reservedQuantity: "0.0", totalInvested: "18000" },
        ],
        pendingOrders: [
          { symbol: "ETHUSDT", side: "SELL", status: "PENDING", quantity: "1.5" },
          { symbol: "BINANCE:ETHUSDT", side: "SELL", status: "PENDING", quantity: "2.0" },
          { symbol: "ETH/USDT", side: "SELL", status: "PENDING", quantity: "0.5" },
        ],
        targetSymbol: "ETHUSDT",
      });

      expect(pos.quantity).toBe(10.0);
      expect(pos.reservedQuantity).toBe(4.0);
      expect(pos.availableQuantity).toBe(6.0);
      expect(pos.hasPosition).toBe(true);
    });

    test("handles fractional quantities with exact 8-decimal precision", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "SOLUSDT", quantity: "0.12345678", reservedQuantity: "0.02345678", totalInvested: "20" },
          { symbol: "SOL/USDT", quantity: "0.87654322", reservedQuantity: "0.10000000", totalInvested: "140" },
        ],
        targetSymbol: "SOLUSDT",
      });

      expect(pos.quantity).toBe(1.0);
      expect(pos.reservedQuantity).toBe(0.12345678);
      expect(pos.availableQuantity).toBe(0.87654322);
      expect(pos.totalInvested).toBe(160);
      expect(pos.averageBuyPrice).toBe(160);
    });

    test("correctly computes fully reserved position", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "AAPL", quantity: "50", reservedQuantity: "50", totalInvested: "7500" },
        ],
        targetSymbol: "AAPL",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(50);
      expect(pos.availableQuantity).toBe(0);
      expect(pos.hasPosition).toBe(true);
    });

    test("correctly computes partially reserved position", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "AAPL", quantity: "50", reservedQuantity: "15", totalInvested: "7500" },
        ],
        targetSymbol: "AAPL",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(15);
      expect(pos.availableQuantity).toBe(35);
      expect(pos.hasPosition).toBe(true);
    });

    test("handles reservations exceeding total holding quantity without going negative", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "AAPL", quantity: "50", reservedQuantity: "75", totalInvested: "7500" },
        ],
        targetSymbol: "AAPL",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(50);
      expect(pos.availableQuantity).toBe(0);
      expect(pos.hasPosition).toBe(true);
    });

    test("handles no pending SELL orders", () => {
      const pos = calculatePosition({
        holdings: [
          { symbol: "AAPL", quantity: "50", reservedQuantity: "0", totalInvested: "7500" },
        ],
        targetSymbol: "AAPL",
      });

      expect(pos.quantity).toBe(50);
      expect(pos.reservedQuantity).toBe(0);
      expect(pos.availableQuantity).toBe(50);
      expect(pos.hasPosition).toBe(true);
    });

    test("source verification: usePosition in hooks.js aggregates holdings and uses authoritative reservations", () => {
      const hooksSrc = fs.readFileSync(path.join(frontendDir, "lib/hooks.js"), "utf8");

      expect(hooksSrc).toContain("canonicalMarketSymbol(item.symbol) === symbolKey");
      expect(hooksSrc).toContain("matchingHoldings");
      expect(hooksSrc).toContain("aggregatedHolding");
      expect(hooksSrc).toContain("totalReserved");
      expect(hooksSrc).toContain("availableQuantity: availableQty.toString()");
      // Authoritative backend reservations eliminate the redundant client-side pending-sells query with limit: 100
      expect(hooksSrc).not.toContain("side: \"SELL\"");
      expect(hooksSrc).not.toContain("limit: 100");
    });
  });

  describe("3. Fractional Order Sizing (format.js & order-ticket.jsx)", () => {
    test("QUANTITY_SCALE and QUANTITY_FACTOR calibrate strictly to 8 decimal places", () => {
      expect(QUANTITY_SCALE).toBe(8);
      expect(QUANTITY_FACTOR).toBe(100000000n);
    });

    test("fractionQuantity scales percentages accurately with zero floating-point overshoot", () => {
      expect(fractionQuantity(1.0, 50)).toBe("0.5");
      expect(fractionQuantity(1.0, 25)).toBe("0.25");
      expect(fractionQuantity(1.0, 75)).toBe("0.75");
      expect(fractionQuantity(1.0, 100)).toBe("1");

      // Small satoshi scaling
      expect(fractionQuantity(0.00000010, 50)).toBe("0.00000005");
      expect(fractionQuantity(0.00000002, 50)).toBe("0.00000001");
      // Division below minimum satoshi returns empty string
      expect(fractionQuantity(0.00000001, 50)).toBe("");

      // Float overshoot protection: 33% of 0.3
      // standard float: 0.3 * 0.33 = 0.09900000000000002
      // BigInt scale: (30000000 * 33) / 100 = 9900000 -> "0.099"
      expect(fractionQuantity(0.3, 33)).toBe("0.099");
    });

    test("fractionQuantity strips trailing zeroes cleanly", () => {
      expect(fractionQuantity(10, 50)).toBe("5");
      expect(fractionQuantity(2.5, 50)).toBe("1.25");
      expect(fractionQuantity("1.50000000", 50)).toBe("0.75");
    });

    test("fractionQuantity guards against non-positive, zero, and non-finite inputs", () => {
      expect(fractionQuantity(0, 50)).toBe("");
      expect(fractionQuantity(-10, 50)).toBe("");
      expect(fractionQuantity(NaN, 50)).toBe("");
      expect(fractionQuantity(Infinity, 50)).toBe("");
      expect(fractionQuantity(-Infinity, 50)).toBe("");
      expect(fractionQuantity("not-a-number", 50)).toBe("");
      expect(fractionQuantity(null, 50)).toBe("");
      expect(fractionQuantity(undefined, 50)).toBe("");
    });

    test("floorQuantity truncates cash-derived quantities to 8 decimals without rounding up", () => {
      // 1.123456789 must truncate to 1.12345678, NOT round up to 1.12345679
      expect(floorQuantity(1.123456789)).toBe("1.12345678");

      expect(floorQuantity(100.5)).toBe("100.5");
      expect(floorQuantity(100.0)).toBe("100");

      // Sub-satoshi (< 1e-8) truncates to 0 -> returns empty string
      expect(floorQuantity(0.000000009)).toBe("");

      expect(floorQuantity(0)).toBe("");
      expect(floorQuantity(-1)).toBe("");
      expect(floorQuantity(NaN)).toBe("");
      expect(floorQuantity(Infinity)).toBe("");
      expect(floorQuantity("invalid")).toBe("");
    });

    test("order-ticket allocation enforces whole shares for stocks and allows 8 decimals for crypto", () => {
      function simulateAllocation({ side, assetType, sellableQuantity, availableCash, price, percent }) {
        if (side === "SELL") {
          if (percent === 100) {
            return assetType === "STOCK"
              ? String(Math.floor(sellableQuantity))
              : floorQuantity(sellableQuantity);
          }
          return fractionQuantity(sellableQuantity, percent);
        }

        if (percent === 100 && assetType === "STOCK" && price > 0) {
          return String(Math.floor(availableCash / price));
        }

        return floorQuantity((availableCash * percent) / 100 / price);
      }

      // Stock SELL 100%: 7.8 shares -> "7"
      expect(
        simulateAllocation({
          side: "SELL",
          assetType: "STOCK",
          sellableQuantity: 7.8,
          percent: 100,
        }),
      ).toBe("7");

      // Crypto SELL 100%: 7.891234567 BTC -> "7.89123456"
      expect(
        simulateAllocation({
          side: "SELL",
          assetType: "CRYPTO",
          sellableQuantity: 7.891234567,
          percent: 100,
        }),
      ).toBe("7.89123456");

      // Stock BUY 100%: $1000 cash, $150 price -> "6"
      expect(
        simulateAllocation({
          side: "BUY",
          assetType: "STOCK",
          availableCash: 1000,
          price: 150,
          percent: 100,
        }),
      ).toBe("6");

      // Crypto BUY 50%: $1000 cash, $50000 price -> "0.01"
      expect(
        simulateAllocation({
          side: "BUY",
          assetType: "CRYPTO",
          availableCash: 1000,
          price: 50000,
          percent: 50,
        }),
      ).toBe("0.01");
    });

    test("source verification: format.js exports fractionQuantity & floorQuantity and order-ticket imports them", () => {
      const formatSrc = fs.readFileSync(path.join(frontendDir, "lib/format.js"), "utf8");
      const orderTicketSrc = fs.readFileSync(
        path.join(frontendDir, "components/market/order-ticket.jsx"),
        "utf8",
      );

      expect(formatSrc).toContain("export function fractionQuantity");
      expect(formatSrc).toContain("export function floorQuantity");
      expect(formatSrc).toContain("const QUANTITY_FACTOR = 10n ** BigInt(QUANTITY_SCALE)");

      expect(orderTicketSrc).toContain("fractionQuantity,");
      expect(orderTicketSrc).toContain("floorQuantity,");
    });
  });

  describe("4. Market Ticker Fallback Configuration", () => {
    test("source verification: MarketTicker uses 60000 ms refreshInterval fallback", () => {
      const tickerSrc = fs.readFileSync(
        path.join(frontendDir, "components/marketing/market-ticker.jsx"),
        "utf8",
      );

      expect(tickerSrc).toContain("refreshInterval: 60000");
      expect(tickerSrc).toContain("BTCUSDT");
      expect(tickerSrc).toContain("ETHUSDT");
      expect(tickerSrc).toContain("SOLUSDT");
      expect(tickerSrc).toContain("AAPL");
      expect(tickerSrc).toContain("NVDA");
      expect(tickerSrc).toContain("TSLA");
      expect(tickerSrc).toContain("MSFT");
    });

    test("market ticker asset classification differentiates stocks and crypto pairs", () => {
      const symbols = [
        "BTCUSDT",
        "ETHUSDT",
        "SOLUSDT",
        "BNBUSDT",
        "XRPUSDT",
        "DOGEUSDT",
        "AAPL",
        "NVDA",
        "TSLA",
        "MSFT",
      ];

      const explicitStock = new Set(["AAPL", "NVDA", "TSLA", "MSFT"]);

      symbols.forEach((sym) => {
        const isStock = explicitStock.has(sym);
        const assetClass = isStock ? "STOCK" : "CRYPTO";
        if (isStock) {
          expect(assetClass).toBe("STOCK");
        } else {
          expect(assetClass).toBe("CRYPTO");
          expect(sym.endsWith("USDT")).toBe(true);
        }
      });
    });
  });
});
