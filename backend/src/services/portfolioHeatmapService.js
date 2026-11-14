const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { getPortfolioReturnSeries } = require("./portfolioSeriesService");

const ZERO = new Prisma.Decimal(0);

/**
 * Generate daily P&L heatmap and performance summary for a portfolio.
 *
 * @param {string} portfolioId
 * @param {Object} [options]
 * @param {string} [options.period="1M"]
 * @param {number|string} [options.year]
 * @param {Date} [options.asOf]
 * @param {boolean} [options.ensureToday=true]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   portfolioId: string,
 *   period: string,
 *   heatmap: Array<{
 *     date: string,
 *     pnl: string,
 *     pnlPercent: string,
 *     totalValue: string
 *   }>,
 *   summary: {
 *     totalPnl: string,
 *     winDays: number,
 *     lossDays: number,
 *     flatDays: number
 *   }
 * }>}
 */
async function getPortfolioPnlHeatmap(portfolioId, {
  period = "1M",
  year = null,
  asOf = new Date(),
  ensureToday = true,
  priceProvider = null,
  client = prisma,
} = {}) {
  const seriesResult = await getPortfolioReturnSeries(portfolioId, {
    period,
    year,
    asOf,
    ensureToday,
    priceProvider,
    client,
  });

  let totalPnl = ZERO;
  let winDays = 0;
  let lossDays = 0;
  let flatDays = 0;

  const heatmap = seriesResult.series.map((item) => {
    const pnl = item.dailyPnl instanceof Prisma.Decimal
      ? item.dailyPnl
      : new Prisma.Decimal(item.dailyPnl || 0);

    const dailyReturn = item.dailyReturn instanceof Prisma.Decimal
      ? item.dailyReturn
      : new Prisma.Decimal(item.dailyReturn || 0);

    const totalValue = item.totalValue instanceof Prisma.Decimal
      ? item.totalValue
      : new Prisma.Decimal(item.totalValue || 0);

    totalPnl = totalPnl.plus(pnl);

    if (pnl.gt(ZERO)) {
      winDays += 1;
    } else if (pnl.lt(ZERO)) {
      lossDays += 1;
    } else {
      flatDays += 1;
    }

    return {
      date: item.date,
      pnl: pnl.toFixed(8),
      pnlPercent: dailyReturn.toFixed(4),
      totalValue: totalValue.toFixed(8),
    };
  });

  return {
    portfolioId,
    period: seriesResult.period,
    heatmap,
    summary: {
      totalPnl: totalPnl.toFixed(8),
      winDays,
      lossDays,
      flatDays,
    },
  };
}

module.exports = {
  getPortfolioPnlHeatmap,
};

