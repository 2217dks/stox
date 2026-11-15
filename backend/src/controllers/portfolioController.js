const portfolioService = require("../services/portfolioService");
const portfolioHeatmapService = require("../services/portfolioHeatmapService");
const riskMetricsService = require("../services/riskMetricsService");
const benchmarkService = require("../services/benchmarkService");
const benchmarkComparisonService = require("../services/benchmarkComparisonService");
const {
  getPortfolioMonthlyPerformance,
} = require("../services/portfolioMonthlyService");

async function listPortfolios(req, res, next) {
  try {
    const userId = req.user.userId;

    const portfolios = await portfolioService.listUserPortfolios(userId);

    return res.status(200).json({
      success: true,
      data: {
        portfolios,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function createPortfolio(req, res, next) {
  try {
    const userId = req.user.userId;

    const { name, description } = req.body;

    const portfolio = await portfolioService.createPortfolio(userId, {
      name,
      description,
    });

    return res.status(201).json({
      success: true,
      data: {
        portfolio,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getPortfolio(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const portfolio = await portfolioService.getPortfolioById(
      userId,
      portfolioId,
    );

    return res.status(200).json({
      success: true,
      data: {
        portfolio,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function updatePortfolio(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const portfolio = await portfolioService.updatePortfolio(
      userId,
      portfolioId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      data: {
        portfolio,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deletePortfolio(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const portfolio = await portfolioService.deactivatePortfolio(
      userId,
      portfolioId,
    );

    return res.status(200).json({
      success: true,
      data: {
        portfolio,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getPortfolioHoldings(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const holdings = await portfolioService.listPortfolioHoldings(
      userId,
      portfolioId,
    );

    return res.status(200).json({
      success: true,
      data: {
        portfolioId,
        holdings,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getPortfolioSummary(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const portfolio = await portfolioService.getPortfolioSummary(
      userId,
      portfolioId,
    );

    return res.status(200).json({
      success: true,
      data: {
        portfolio,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getCashBalance(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;

    const result = await portfolioService.getPortfolioCashBalance(
      userId,
      portfolioId,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getPnlHeatmap(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;
    const { period, year } = req.validatedQuery || {};

    await portfolioService.getPortfolioById(userId, portfolioId);

    const result = await portfolioHeatmapService.getPortfolioPnlHeatmap(
      portfolioId,
      { period, year },
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getRiskMetrics(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;
    const { period, riskFreeRate } = req.validatedQuery || {};

    await portfolioService.getPortfolioById(userId, portfolioId);

    const result = await riskMetricsService.getPortfolioRiskMetrics(
      portfolioId,
      { period, riskFreeRate },
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getBenchmark(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;
    const { symbol, period } = req.validatedQuery || {};

    await portfolioService.getPortfolioById(userId, portfolioId);

    const result = await benchmarkService.getBenchmarkData(symbol, {
      period,
      portfolioId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getBenchmarkComparison(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams;
    const { symbol, period, riskFreeRate } = req.validatedQuery || {};

    await portfolioService.getPortfolioById(userId, portfolioId);

    const result = await benchmarkComparisonService.getBenchmarkComparison(
      portfolioId,
      {
        symbol,
        period,
        riskFreeRate,
      },
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getMonthlyPerformance(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.validatedParams ?? req.params;
    const options = req.validatedQuery ?? req.query ?? {};

    const result = await getPortfolioMonthlyPerformance(
      portfolioId,
      userId,
      options,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listPortfolios,
  createPortfolio,
  getPortfolio,
  updatePortfolio,
  deletePortfolio,
  getPortfolioHoldings,
  getCashBalance,
  getPortfolioSummary,
  getPnlHeatmap,
  getRiskMetrics,
  getBenchmark,
  getBenchmarkComparison,
  getMonthlyPerformance,
};
