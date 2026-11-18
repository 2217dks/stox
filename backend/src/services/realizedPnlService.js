const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { resolveDateRange } = require("./portfolioSeriesService");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

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

/**
 * Pure calculation of realized P&L metrics from a list of completed trade rows.
 *
 * Sign conventions:
 * - Positive (> 0): Net profit
 * - Negative (< 0): Net loss
 * - Zero (= 0): Breakeven
 *
 * Preserves Decimal(18, 8) precision across partial closes, multiple fills, and fee deductions.
 */
function calculateRealizedPnl(trades = []) {
  let totalRealizedPnl = ZERO;
  let totalProceeds = ZERO;
  let totalCostBasis = ZERO;
  let totalFees = ZERO;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;

  const symbolMap = new Map();

  const formattedTrades = [];

  for (const trade of trades) {
    if (trade.realizedPnl === null || trade.realizedPnl === undefined) {
      continue;
    }

    const pnl = toDecimal(trade.realizedPnl);
    const pnlPct = trade.realizedPnlPct !== null && trade.realizedPnlPct !== undefined
      ? toDecimal(trade.realizedPnlPct)
      : null;
    const value = toDecimal(trade.totalValue);
    const fees = toDecimal(trade.fees || 0);
    // Cost basis = totalValue - realizedPnl - fees
    const costBasis = value.minus(pnl).minus(fees);

    totalRealizedPnl = totalRealizedPnl.plus(pnl);
    totalProceeds = totalProceeds.plus(value);
    totalCostBasis = totalCostBasis.plus(costBasis);
    totalFees = totalFees.plus(fees);

    if (pnl.gt(ZERO)) {
      winningTrades += 1;
    } else if (pnl.lt(ZERO)) {
      losingTrades += 1;
    } else {
      breakevenTrades += 1;
    }

    const sym = trade.symbol.toUpperCase();
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, {
        symbol: sym,
        realizedPnl: ZERO,
        proceeds: ZERO,
        costBasis: ZERO,
        fees: ZERO,
        tradeCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
      });
    }

    const symStats = symbolMap.get(sym);
    symStats.realizedPnl = symStats.realizedPnl.plus(pnl);
    symStats.proceeds = symStats.proceeds.plus(value);
    symStats.costBasis = symStats.costBasis.plus(costBasis);
    symStats.fees = symStats.fees.plus(fees);
    symStats.tradeCount += 1;
    if (pnl.gt(ZERO)) symStats.winningTrades += 1;
    else if (pnl.lt(ZERO)) symStats.losingTrades += 1;
    else symStats.breakevenTrades += 1;

    formattedTrades.push({
      id: trade.id,
      orderId: trade.orderId,
      symbol: trade.symbol,
      side: trade.side,
      quantity: toDecimalString(trade.quantity),
      price: toDecimalString(trade.price),
      totalValue: toDecimalString(trade.totalValue),
      costBasis: toDecimalString(costBasis),
      fees: toDecimalString(fees),
      realizedPnl: toDecimalString(pnl),
      realizedPnlPct: pnlPct ? toDecimalString(pnlPct, 4) : null,
      executedAt: trade.executedAt instanceof Date ? trade.executedAt.toISOString() : trade.executedAt,
    });
  }

  const tradeCount = formattedTrades.length;
  const totalRealizedPnlPct = totalCostBasis.gt(ZERO)
    ? totalRealizedPnl.dividedBy(totalCostBasis).times(ONE_HUNDRED)
    : ZERO;

  const winRate = tradeCount > 0
    ? (winningTrades / tradeCount)
    : 0;

  const bySymbol = Array.from(symbolMap.values()).map((item) => ({
    symbol: item.symbol,
    realizedPnl: toDecimalString(item.realizedPnl),
    realizedPnlPct: item.costBasis.gt(ZERO)
      ? toDecimalString(item.realizedPnl.dividedBy(item.costBasis).times(ONE_HUNDRED), 4)
      : "0.0000",
    proceeds: toDecimalString(item.proceeds),
    costBasis: toDecimalString(item.costBasis),
    fees: toDecimalString(item.fees),
    tradeCount: item.tradeCount,
    winningTrades: item.winningTrades,
    losingTrades: item.losingTrades,
    breakevenTrades: item.breakevenTrades,
  }));

  return {
    realizedPnl: toDecimalString(totalRealizedPnl),
    realizedPnlPct: toDecimalString(totalRealizedPnlPct, 4),
    totalProceeds: toDecimalString(totalProceeds),
    totalCostBasis: toDecimalString(totalCostBasis),
    totalFees: toDecimalString(totalFees),
    tradeCount,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRate: Number(winRate.toFixed(4)),
    bySymbol,
    trades: formattedTrades,
  };
}

/**
 * Fetch and calculate realized P&L for a caller-owned portfolio.
 */
async function getPortfolioRealizedPnl(
  userId,
  portfolioId,
  {
    period = "ALL",
    from = null,
    to = null,
    symbol = null,
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
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  let startDate = null;
  let endDate = asOf instanceof Date ? asOf : new Date(asOf);

  if (from || to) {
    startDate = from ? (from instanceof Date ? from : new Date(from)) : null;
    endDate = to ? (to instanceof Date ? to : new Date(to)) : endDate;
  } else if (period && period.toUpperCase() !== "ALL") {
    const range = resolveDateRange({ period, asOf });
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const where = {
    portfolioId,
    realizedPnl: { not: null },
  };

  if (symbol) {
    where.symbol = symbol.toUpperCase();
  }

  if (startDate || endDate) {
    where.executedAt = {};
    if (startDate) where.executedAt.gte = startDate;
    if (endDate) where.executedAt.lt = endDate;
  }

  const trades = await prisma.trade.findMany({
    where,
    orderBy: { executedAt: "desc" },
    select: {
      id: true,
      orderId: true,
      symbol: true,
      side: true,
      quantity: true,
      price: true,
      totalValue: true,
      fees: true,
      realizedPnl: true,
      realizedPnlPct: true,
      executedAt: true,
    },
  });

  const metrics = calculateRealizedPnl(trades);

  return {
    portfolioId: portfolio.id,
    period: period.toUpperCase(),
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null,
    ...metrics,
  };
}

module.exports = {
  calculateRealizedPnl,
  getPortfolioRealizedPnl,
};
