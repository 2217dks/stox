/**
 * Canonical symbol normalizer matching frontend/lib/utils.js
 */
function canonicalMarketSymbol(symbol = "") {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^(?:BINANCE|FINNHUB|YAHOO):/, "")
    .replace(/\//g, "");
}

/**
 * isCrypto heuristic matching frontend/lib/format.js
 */
function isCrypto(symbol = "", assetType) {
  if (assetType) return assetType === "CRYPTO";
  const upper = String(symbol || "").trim().toUpperCase();
  const clean = upper.replace(/^BINANCE:/, "");
  if (upper.startsWith("BINANCE:") || clean.includes("/")) return true;
  return /^[A-Z0-9]{6,30}$/.test(clean);
}

/**
 * Filter holdings for a given market symbol and optional asset type.
 *
 * Rules:
 * - Matches on canonicalMarketSymbol(holding.symbol) === canonicalMarketSymbol(symbol)
 * - If explicitAssetType is provided, strictly matches holding.assetType === explicitAssetType
 *   (returns empty array if no match; never falls back to another asset class)
 * - If explicitAssetType is omitted:
 *   - If all matches share the same asset type, returns all matches
 *   - If matches have mixed asset types, isolates by the natural asset class (isCrypto(symbol))
 *     so distinct asset classes (e.g. STOCK vs CRYPTO) are never aggregated together
 */
function filterHoldingsForPosition(
  holdings = [],
  symbol = "",
  explicitAssetType = null,
) {
  const symbolKey = canonicalMarketSymbol(symbol);
  if (!symbolKey || !Array.isArray(holdings) || holdings.length === 0) {
    return [];
  }

  const matches = holdings.filter(
    (item) => canonicalMarketSymbol(item?.symbol) === symbolKey,
  );
  if (!matches.length) return [];

  if (explicitAssetType) {
    return matches.filter((item) => item.assetType === explicitAssetType);
  }

  const firstType = matches[0]?.assetType;
  const hasMixedTypes = matches.some(
    (item) => item.assetType && firstType && item.assetType !== firstType,
  );
  if (hasMixedTypes) {
    const preferredType = isCrypto(symbol) ? "CRYPTO" : "STOCK";
    const preferredMatches = matches.filter(
      (item) => item.assetType === preferredType,
    );
    return preferredMatches.length > 0
      ? preferredMatches
      : matches.filter((item) => item.assetType === firstType);
  }

  return matches;
}

/**
 * Aggregate multiple holding records belonging to the same canonical instrument
 * into a single unified position record with consistent 8-decimal precision.
 */
function aggregateHoldings(matchingHoldings = []) {
  if (!Array.isArray(matchingHoldings) || !matchingHoldings.length) {
    return null;
  }

  const first = matchingHoldings[0];
  let totalQty = 0;
  let totalReserved = 0;
  let totalInvested = 0;

  for (const h of matchingHoldings) {
    totalQty += Number(h.quantity || 0);
    totalReserved += Number(h.reservedQuantity || 0);
    totalInvested += Number(
      h.totalInvested !== undefined && h.totalInvested !== null
        ? h.totalInvested
        : Number(h.quantity || 0) * Number(h.averageBuyPrice || 0),
    );
  }

  const netQty = Number(totalQty.toFixed(8));
  const netReserved = Number(
    Math.min(Math.max(totalReserved, 0), netQty).toFixed(8),
  );
  const availableQty = Number(Math.max(0, netQty - netReserved).toFixed(8));
  const avgBuyPrice = netQty > 0 ? totalInvested / netQty : 0;

  return {
    ...first,
    quantity: netQty.toString(),
    reservedQuantity: netReserved.toString(),
    availableQuantity: availableQty.toString(),
    averageBuyPrice: avgBuyPrice.toString(),
    totalInvested: totalInvested.toString(),
  };
}

/**
 * Pure calculation helper returning the full position state for a symbol and asset type.
 * Used directly by usePosition() and test suites.
 */
function calculatePosition({
  holding = null,
  holdings = [],
  pendingOrders = [],
  targetSymbol = "",
  assetType = null,
}) {
  const symbolKey = canonicalMarketSymbol(targetSymbol);
  const rawList = holdings.length > 0 ? holdings : holding ? [holding] : [];
  const matchedHoldings = filterHoldingsForPosition(
    rawList,
    targetSymbol,
    assetType,
  );
  if (!symbolKey || !matchedHoldings.length) {
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

  const aggregated = aggregateHoldings(matchedHoldings);
  let totalReserved = aggregated ? Number(aggregated.reservedQuantity || 0) : 0;

  if (
    totalReserved === 0 &&
    Array.isArray(pendingOrders) &&
    pendingOrders.length > 0
  ) {
    totalReserved = pendingOrders
      .filter(
        (order) =>
          order.side === "SELL" &&
          order.status === "PENDING" &&
          canonicalMarketSymbol(order.symbol) === symbolKey &&
          (!assetType || !order.assetType || order.assetType === assetType),
      )
      .reduce((total, order) => total + Number(order.quantity || 0), 0);
  }

  const netQty = aggregated ? Number(aggregated.quantity) : 0;
  const netReserved = Number(
    Math.min(Math.max(totalReserved, 0), netQty).toFixed(8),
  );
  const availableQuantity = Number(Math.max(0, netQty - netReserved).toFixed(8));
  const averageBuyPrice = aggregated ? Number(aggregated.averageBuyPrice) : 0;
  const totalInvested = aggregated ? Number(aggregated.totalInvested) : 0;

  const finalHolding = aggregated
    ? {
        ...aggregated,
        reservedQuantity: netReserved.toString(),
        availableQuantity: availableQuantity.toString(),
      }
    : null;

  return {
    holding: finalHolding,
    quantity: netQty,
    reservedQuantity: netReserved,
    availableQuantity,
    averageBuyPrice,
    totalInvested,
    hasPosition: netQty > 0,
  };
}

module.exports = {
  canonicalMarketSymbol,
  isCrypto,
  filterHoldingsForPosition,
  aggregateHoldings,
  calculatePosition,
};
