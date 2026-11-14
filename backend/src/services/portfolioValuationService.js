const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { AppError } = require("../utils/errors");

const ZERO = new Prisma.Decimal(0);

/**
 * Calculate the live market valuation for a portfolio using current prices.
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

  if (holdings.length === 0) {
    return {
      portfolioId: portfolio.id,
      cashBalance,
      holdingsValue: ZERO,
      totalValue: cashBalance,
      asOf,
      holdings: [],
    };
  }

  // Fetch quotes for all open holdings in parallel
  const quotes = await Promise.all(
    holdings.map(async (holding) => {
      try {
        const quote = await priceProvider.getQuote(holding.symbol, {
          assetClass: holding.assetType,
        });

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
    asOf,
    holdings: quotes,
  };
}

module.exports = {
  calculatePortfolioValuation,
};

