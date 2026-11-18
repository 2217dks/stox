const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const defaultMarketData = require("./marketData");
const { AppError } = require("../utils/errors");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

const DEFAULT_FRESHNESS_THRESHOLDS = Object.freeze({
  CRYPTO: 60,
  STOCK: 300,
  DEFAULT: 120,
});

function toDecimal(val) {
  if (val === null || val === undefined) return ZERO;
  try {
    return new Prisma.Decimal(val);
  } catch {
    return ZERO;
  }
}

function toDecimalString(val, decimals = 8) {
  if (val === null || val === undefined) return null;
  const d = toDecimal(val);
  return d.toFixed(decimals);
}

function parseQuoteTimestamp(quote) {
  const raw = quote?.timestamp ?? quote?.asOf ?? quote?.t;
  if (raw === undefined || raw === null || raw === "") return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === "number") {
    // If under 10 billion, likely Unix seconds
    const ms = raw < 10000000000 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function evaluateHoldingFreshness(quote, assetType, { maxAgeSeconds, now = new Date() } = {}) {
  // If the quote already carries explicit freshness evaluated upstream
  if (quote && typeof quote.isStale === "boolean" && typeof quote.freshness === "string") {
    if (typeof maxAgeSeconds === "number" && typeof quote.ageSeconds === "number") {
      const isStale = quote.ageSeconds > maxAgeSeconds;
      return {
        isStale,
        freshness: isStale ? "STALE" : "FRESH",
        ageSeconds: quote.ageSeconds,
        priceTimestamp: quote.timestamp || quote.priceTimestamp || null,
      };
    }
    return {
      isStale: quote.isStale,
      freshness: quote.freshness,
      ageSeconds: quote.ageSeconds ?? 0,
      priceTimestamp: quote.timestamp || quote.priceTimestamp || null,
    };
  }

  const quoteDate = parseQuoteTimestamp(quote);
  const nowDate = now instanceof Date ? now : new Date(now);

  if (!quoteDate) {
    // If no timestamp is provided, treat as fresh if live, or flag with default 0
    return {
      isStale: false,
      freshness: "FRESH",
      ageSeconds: 0,
      priceTimestamp: nowDate.toISOString(),
    };
  }

  const ageSeconds = Math.max(0, Math.floor((nowDate.getTime() - quoteDate.getTime()) / 1000));
  const threshold = typeof maxAgeSeconds === "number"
    ? maxAgeSeconds
    : (DEFAULT_FRESHNESS_THRESHOLDS[assetType] || DEFAULT_FRESHNESS_THRESHOLDS.DEFAULT);

  const isStale = ageSeconds > threshold;

  return {
    isStale,
    freshness: isStale ? "STALE" : "FRESH",
    ageSeconds,
    priceTimestamp: quoteDate.toISOString(),
  };
}

/**
 * Pure calculation of unrealized P&L from a holding and resolved market quote.
 */
function calculatePositionUnrealizedPnl(holding, quote, options = {}) {
  if (!quote || quote.price === undefined || quote.price === null) {
    throw new AppError(
      `Market price unavailable for ${holding.symbol}.`,
      {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        details: { symbol: holding.symbol },
      },
    );
  }

  const currentPrice = toDecimal(quote.price);
  if (currentPrice.lte(ZERO)) {
    throw new AppError(
      `Non-positive price returned for ${holding.symbol}.`,
      {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        details: { symbol: holding.symbol },
      },
    );
  }

  const freshness = evaluateHoldingFreshness(quote, holding.assetType, options);

  if (freshness.isStale && options.rejectStale) {
    throw new AppError(
      `Market data quote is stale for ${holding.symbol}.`,
      {
        statusCode: 503,
        code: "MARKET_DATA_STALE_QUOTE",
        details: {
          symbol: holding.symbol,
          ageSeconds: freshness.ageSeconds,
          freshness: freshness.freshness,
        },
      },
    );
  }

  const quantity = toDecimal(holding.quantity);
  const averageBuyPrice = toDecimal(holding.averageBuyPrice);
  const totalInvested = toDecimal(holding.totalInvested);
  const marketValue = quantity.times(currentPrice);

  const isShort = Boolean(holding.isShort);
  const unrealizedPnl = isShort
    ? totalInvested.minus(marketValue)
    : marketValue.minus(totalInvested);

  const unrealizedPnlPct = totalInvested.gt(ZERO)
    ? unrealizedPnl.dividedBy(totalInvested).times(ONE_HUNDRED)
    : ZERO;

  return {
    id: holding.id,
    symbol: holding.symbol,
    assetType: holding.assetType,
    isShort,
    quantity: toDecimalString(quantity),
    averageBuyPrice: toDecimalString(averageBuyPrice),
    totalInvested: toDecimalString(totalInvested),
    currentPrice: toDecimalString(currentPrice),
    marketValue: toDecimalString(marketValue),
    unrealizedPnl: toDecimalString(unrealizedPnl),
    unrealizedPnlPct: toDecimalString(unrealizedPnlPct, 4),
    isStale: freshness.isStale,
    freshness: freshness.freshness,
    ageSeconds: freshness.ageSeconds,
    priceTimestamp: freshness.priceTimestamp,
  };
}

/**
 * Fetch open holdings and calculate live unrealized P&L for a portfolio.
 */
async function getPortfolioUnrealizedPnl(
  userId,
  portfolioId,
  {
    priceProvider = defaultMarketData,
    rejectStale = false,
    allowStale = false,
    maxAgeSeconds = undefined,
    asOf = new Date(),
  } = {},
) {
  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      cashBalance: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  const holdings = await prisma.holding.findMany({
    where: {
      portfolioId,
      quantity: { gt: 0 },
    },
    orderBy: { symbol: "asc" },
  });

  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);

  if (holdings.length === 0) {
    return {
      portfolioId: portfolio.id,
      totalInvested: "0.00000000",
      marketValue: "0.00000000",
      unrealizedPnl: "0.00000000",
      unrealizedPnlPct: "0.0000",
      isStale: false,
      freshness: "FRESH",
      positionCount: 0,
      asOf: asOfDate.toISOString(),
      positions: [],
    };
  }

  // Fetch quotes in parallel
  const positions = await Promise.all(
    holdings.map(async (holding) => {
      const quote = await priceProvider.getQuote(holding.symbol, {
        assetClass: holding.assetType,
      });

      return calculatePositionUnrealizedPnl(holding, quote, {
        rejectStale,
        allowStale,
        maxAgeSeconds,
        now: asOfDate,
      });
    }),
  );

  let totalInvested = ZERO;
  let totalMarketValue = ZERO;
  let totalUnrealizedPnl = ZERO;
  let hasStalePosition = false;
  let maxAge = 0;

  for (const pos of positions) {
    totalInvested = totalInvested.plus(toDecimal(pos.totalInvested));
    totalMarketValue = totalMarketValue.plus(toDecimal(pos.marketValue));
    totalUnrealizedPnl = totalUnrealizedPnl.plus(toDecimal(pos.unrealizedPnl));
    if (pos.isStale) hasStalePosition = true;
    if (typeof pos.ageSeconds === "number" && pos.ageSeconds > maxAge) {
      maxAge = pos.ageSeconds;
    }
  }

  const totalUnrealizedPnlPct = totalInvested.gt(ZERO)
    ? totalUnrealizedPnl.dividedBy(totalInvested).times(ONE_HUNDRED)
    : ZERO;

  return {
    portfolioId: portfolio.id,
    totalInvested: toDecimalString(totalInvested),
    marketValue: toDecimalString(totalMarketValue),
    unrealizedPnl: toDecimalString(totalUnrealizedPnl),
    unrealizedPnlPct: toDecimalString(totalUnrealizedPnlPct, 4),
    isStale: hasStalePosition,
    freshness: hasStalePosition ? "STALE" : "FRESH",
    maxAgeSeconds: maxAge,
    positionCount: positions.length,
    asOf: asOfDate.toISOString(),
    positions,
  };
}

module.exports = {
  calculatePositionUnrealizedPnl,
  getPortfolioUnrealizedPnl,
  evaluateHoldingFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS,
};
