const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { AppError } = require("../utils/errors");
const { toDecimalString } = require("../utils/decimal");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

const SUPPORTED_DIMENSIONS = Object.freeze({
  SYMBOL: "symbol",
  ASSET: "asset",
  ASSETTYPE: "asset",
});


/**
 * Reconcile formatted percentage strings to sum exactly to 100.0000%.
 *
 * Distributes rounding residual to the component with the largest absolute weight.
 *
 * @param {Array<{ percentage: string, rawPct: Prisma.Decimal, value: Prisma.Decimal }>} items
 * @param {Prisma.Decimal} totalValue
 * @returns {Array<Object>}
 */
function reconcilePercentages(items, totalValue) {
  if (!items || items.length === 0 || totalValue.lte(ZERO)) {
    return items.map((item) => ({
      ...item,
      percentage: "0.0000",
      rawPct: undefined,
    }));
  }

  // 1. Compute initial 4-decimal formatted percentage for each item
  let sumFormatted = ZERO;
  let maxWeightIndex = 0;
  let maxWeightValue = ZERO;

  const result = items.map((item, idx) => {
    const raw = item.value.dividedBy(totalValue).times(ONE_HUNDRED);
    const formattedStr = raw.toFixed(4);
    const formattedDecimal = new Prisma.Decimal(formattedStr);
    sumFormatted = sumFormatted.plus(formattedDecimal);

    if (item.value.gt(maxWeightValue)) {
      maxWeightValue = item.value;
      maxWeightIndex = idx;
    }

    return {
      ...item,
      percentage: formattedStr,
      rawDecimal: formattedDecimal,
    };
  });

  // 2. Adjust rounding residual against largest holding/cash
  const residual = ONE_HUNDRED.minus(sumFormatted);
  if (!residual.isZero() && result.length > 0) {
    const adjusted = result[maxWeightIndex].rawDecimal.plus(residual);
    result[maxWeightIndex].percentage = adjusted.toFixed(4);
  }

  return result.map(({ rawDecimal, ...rest }) => rest);
}

/**
 * Calculate portfolio allocation by approved dimensions such as asset class or symbol.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {string} portfolioId - Target portfolio UUID
 * @param {Object} [options]
 * @param {string} [options.dimension="symbol"] - "symbol" or "asset"
 * @param {Object} [options.marketDataProvider] - Market data quote provider
 * @param {Object} [options.client] - Prisma client override
 * @returns {Promise<Object>} Reconciled portfolio allocation breakdown
 */
async function getPortfolioAllocation(
  userId,
  portfolioId,
  {
    dimension = "symbol",
    marketDataProvider = defaultMarketData,
    client = prisma,
  } = {},
) {
  // 1. Verify dimension
  const normalizedDim = String(dimension || "symbol").trim().toLowerCase();
  const canonicalDimension = SUPPORTED_DIMENSIONS[normalizedDim.toUpperCase()];

  if (!canonicalDimension) {
    throw AppError.badRequest(
      `Invalid dimension '${dimension}'. Supported dimensions: 'symbol', 'asset'.`,
      "INVALID_ALLOCATION_DIMENSION",
    );
  }

  // 2. Verify portfolio ownership
  const portfolio = await client.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      name: true,
      cashBalance: true,
      startingBalance: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  // 3. Query open holdings
  const holdings = await client.holding.findMany({
    where: {
      portfolioId,
      quantity: { gt: 0 },
    },
    select: {
      id: true,
      symbol: true,
      assetType: true,
      quantity: true,
      averageBuyPrice: true,
      totalInvested: true,
    },
  });

  // 4. Fetch quotes and price positions
  let totalHoldingsValue = ZERO;
  const pricedHoldings = [];

  for (const h of holdings) {
    const qty = new Prisma.Decimal(h.quantity);
    const avgBuyPrice = new Prisma.Decimal(h.averageBuyPrice);

    let price = avgBuyPrice;
    let priceSource = "cost_basis";
    let isPriceEstimated = true;

    try {
      if (marketDataProvider && typeof marketDataProvider.getQuote === "function") {
        const quote = await marketDataProvider.getQuote(h.symbol, {
          assetClass: h.assetType,
        });

        if (quote && quote.price) {
          const isStale = Boolean(
            quote.isStale === true ||
            quote.freshness === "STALE" ||
            quote.freshness === "FUTURE",
          );

          if (!isStale) {
            const fetchedPrice = new Prisma.Decimal(quote.price);
            if (fetchedPrice.gt(ZERO)) {
              price = fetchedPrice;
              priceSource = "live";
              isPriceEstimated = false;
            }
          } else {
            // Stale market quotes must never be silently reported as live prices.
            // Fall back to holding's average buy price and mark as estimated valuation.
            price = avgBuyPrice;
            priceSource = "cost_basis";
            isPriceEstimated = true;
          }
        }
      }
    } catch {
      // Graceful fallback to cost basis when live price fails or is missing
      price = avgBuyPrice;
      priceSource = "cost_basis";
      isPriceEstimated = true;
    }

    const marketValue = qty.times(price);
    totalHoldingsValue = totalHoldingsValue.plus(marketValue);

    pricedHoldings.push({
      symbol: h.symbol,
      assetType: h.assetType,
      quantity: qty,
      price,
      priceSource,
      isPriceEstimated,
      value: marketValue,
    });
  }

  // 5. Cash treatment and total portfolio value
  const cashValue = new Prisma.Decimal(portfolio.cashBalance);
  const totalPortfolioValue = cashValue.plus(totalHoldingsValue);

  // 6. Aggregate by selected dimension
  let unallocatedItems = [];

  if (canonicalDimension === "symbol") {
    // Breakdown by symbol + CASH
    for (const item of pricedHoldings) {
      unallocatedItems.push({
        key: item.symbol,
        name: item.symbol,
        dimension: "symbol",
        assetType: item.assetType,
        quantity: toDecimalString(item.quantity),
        price: toDecimalString(item.price),
        priceSource: item.priceSource,
        isPriceEstimated: item.isPriceEstimated,
        value: item.value,
      });
    }

    // Include Cash
    unallocatedItems.push({
      key: "CASH",
      name: "Cash Balance",
      dimension: "symbol",
      assetType: "CASH",
      quantity: "1.00000000",
      price: toDecimalString(cashValue),
      priceSource: "portfolio",
      isPriceEstimated: false,
      value: cashValue,
    });
  } else {
    // Breakdown by asset class (STOCK, CRYPTO, CASH)
    const assetBuckets = new Map();

    for (const item of pricedHoldings) {
      const typeKey = String(item.assetType).toUpperCase();
      const existing = assetBuckets.get(typeKey) || {
        key: typeKey,
        name: typeKey === "STOCK" ? "Stocks" : typeKey === "CRYPTO" ? "Crypto" : typeKey,
        dimension: "asset",
        assetType: typeKey,
        holdingsCount: 0,
        value: ZERO,
        hasEstimatedPrice: false,
        isPriceEstimated: false,
      };

      existing.holdingsCount += 1;
      existing.value = existing.value.plus(item.value);
      if (item.isPriceEstimated) {
        existing.hasEstimatedPrice = true;
        existing.isPriceEstimated = true;
      }
      assetBuckets.set(typeKey, existing);
    }

    unallocatedItems = Array.from(assetBuckets.values());

    // Include Cash as an asset class
    unallocatedItems.push({
      key: "CASH",
      name: "Cash",
      dimension: "asset",
      assetType: "CASH",
      holdingsCount: 1,
      value: cashValue,
      hasEstimatedPrice: false,
      isPriceEstimated: false,
    });
  }

  // 7. Sort items descending by value
  unallocatedItems.sort((a, b) => {
    if (b.value.gt(a.value)) return 1;
    if (b.value.lt(a.value)) return -1;
    return a.key.localeCompare(b.key);
  });

  // 8. Reconcile percentages to guarantee exact 100.0000%
  const reconciledItems = reconcilePercentages(unallocatedItems, totalPortfolioValue);

  // Format decimal values to strings
  let sumAllocated = ZERO;
  let sumReconciledPct = ZERO;

  const formattedItems = reconciledItems.map((item) => {
    sumAllocated = sumAllocated.plus(item.value);
    sumReconciledPct = sumReconciledPct.plus(new Prisma.Decimal(item.percentage));

    return {
      ...item,
      value: toDecimalString(item.value),
    };
  });

  const isReconciled = totalPortfolioValue.gt(ZERO)
    ? sumReconciledPct.equals(ONE_HUNDRED)
    : sumReconciledPct.equals(ZERO);

  const hasEstimatedPrices = pricedHoldings.some((h) => h.isPriceEstimated);
  const estimatedHoldingsCount = pricedHoldings.filter((h) => h.isPriceEstimated).length;
  const liveHoldingsCount = pricedHoldings.filter((h) => !h.isPriceEstimated).length;
  const valuationMethod = hasEstimatedPrices ? "estimated" : "market";

  return {
    portfolioId,
    dimension: canonicalDimension,
    totalPortfolioValue: toDecimalString(totalPortfolioValue),
    cashBalance: toDecimalString(cashValue),
    holdingsValue: toDecimalString(totalHoldingsValue),
    holdingsCount: holdings.length,
    isEstimated: hasEstimatedPrices,
    valuationMethod,
    pricingSummary: {
      totalHoldings: holdings.length,
      liveQuotes: liveHoldingsCount,
      estimatedQuotes: estimatedHoldingsCount,
      hasEstimatedPrices,
    },
    allocations: formattedItems,
    reconciliation: {
      totalPortfolioValue: toDecimalString(totalPortfolioValue),
      sumAllocatedValue: toDecimalString(sumAllocated),
      totalPercentage: sumReconciledPct.toFixed(4),
      isReconciled,
      isEstimated: hasEstimatedPrices,
      valuationMethod,
    },
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  getPortfolioAllocation,
  reconcilePercentages,
  SUPPORTED_DIMENSIONS,
};
