const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { AppError } = require("../utils/errors");

const ZERO = new Prisma.Decimal(0);

/**
 * Resolve price for a holding as of a specific date/time.
 * If isHistorical is true, queries historical price/close rather than live quote.
 */
async function resolveHoldingPrice(holding, asOfDate, priceProvider, isHistorical) {
  // 1. If provider supports getHistoricalPrice and we are valuing historically
  if (isHistorical && typeof priceProvider.getHistoricalPrice === "function") {
    const historicalQuote = await priceProvider.getHistoricalPrice(holding.symbol, {
      asOf: asOfDate,
      assetClass: holding.assetType,
    });
    if (historicalQuote && historicalQuote.price !== undefined && historicalQuote.price !== null) {
      return historicalQuote;
    }
  }

  // 2. If provider supports getHistoricalPrices and we are valuing historically
  if (isHistorical && typeof priceProvider.getHistoricalPrices === "function") {
    const toMs = Math.min(asOfDate.getTime(), Date.now());
    const fromMs = Math.max(0, toMs - 7 * 24 * 60 * 60 * 1000);
    if (fromMs < toMs) {
      const history = await priceProvider.getHistoricalPrices(holding.symbol, {
        interval: "1d",
        from: fromMs,
        to: toMs,
        limit: 10,
        assetClass: holding.assetType,
      });

      if (history && Array.isArray(history.prices) && history.prices.length > 0) {
        const eligible = history.prices.filter(
          (c) => new Date(c.timestamp).getTime() <= toMs,
        );
        if (eligible.length > 0) {
          const candle = eligible[eligible.length - 1];
          return {
            symbol: holding.symbol,
            price: candle.close,
            timestamp: candle.timestamp,
          };
        }
      }
    }
  }

  // 3. Live quote path (or mock provider where only getQuote is implemented)
  if (typeof priceProvider.getQuote === "function") {
    return priceProvider.getQuote(holding.symbol, {
      assetClass: holding.assetType,
      asOf: asOfDate,
    });
  }

  throw new Error(`No quote or historical price method available on provider for ${holding.symbol}`);
}

/**
 * Calculate the market valuation for a portfolio using current prices or historical EOD closes.
 *
 * Invariant: Never treats missing, null, or stale prices as zero.
 * If quote retrieval fails for any held instrument, it surfaces a provider error
 * to prevent corrupted or artificially depreciated valuations.
 */
async function calculatePortfolioValuation(
  portfolioId,
  {
    client = prisma,
    priceProvider = defaultMarketData,
    asOf = new Date(),
    historical = null,
  } = {},
) {
  const portfolio = await client.portfolio.findUnique({
    where: { id: portfolioId },
    select: {
      id: true,
      cashBalance: true,
      startingBalance: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw new AppError("Portfolio not found.", {
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  }

  const holdings = await client.holding.findMany({
    where: {
      portfolioId,
      quantity: {
        gt: 0,
      },
    },
    orderBy: {
      symbol: "asc",
    },
  });

  const cashBalance = new Prisma.Decimal(portfolio.cashBalance);
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const now = new Date();
  const isHistorical = historical !== null
    ? Boolean(historical)
    : asOfDate.toISOString().slice(0, 10) < now.toISOString().slice(0, 10);

  if (holdings.length === 0) {
    return {
      portfolioId: portfolio.id,
      cashBalance,
      holdingsValue: ZERO,
      totalValue: cashBalance,
      asOf: asOfDate,
      holdings: [],
    };
  }

  // Fetch prices for all open holdings in parallel
  const quotes = await Promise.all(
    holdings.map(async (holding) => {
      try {
        const quote = await resolveHoldingPrice(
          holding,
          asOfDate,
          priceProvider,
          isHistorical,
        );

        if (!quote || quote.price === undefined || quote.price === null) {
          throw new Error(`Quote price is missing for ${holding.symbol}`);
        }

        const priceDecimal = new Prisma.Decimal(quote.price);
        if (priceDecimal.lte(ZERO)) {
          throw new Error(`Non-positive price returned for ${holding.symbol}`);
        }

        const quantityDecimal = new Prisma.Decimal(holding.quantity);
        const value = quantityDecimal.times(priceDecimal);

        return {
          symbol: holding.symbol,
          assetType: holding.assetType,
          quantity: quantityDecimal,
          price: priceDecimal,
          value,
        };
      } catch (error) {
        // Do not swallow quote failure or substitute zero
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError(
          `Market price unavailable for ${holding.symbol}: ${error.message}`,
          {
            statusCode: 503,
            code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
            details: { symbol: holding.symbol, assetType: holding.assetType },
          },
        );
      }
    }),
  );

  let totalHoldingsValue = ZERO;
  for (const item of quotes) {
    totalHoldingsValue = totalHoldingsValue.plus(item.value);
  }

  const totalValue = cashBalance.plus(totalHoldingsValue);

  return {
    portfolioId: portfolio.id,
    cashBalance,
    holdingsValue: totalHoldingsValue,
    totalValue,
    asOf: asOfDate,
    holdings: quotes,
  };
}

module.exports = {
  calculatePortfolioValuation,
  resolveHoldingPrice,
};
