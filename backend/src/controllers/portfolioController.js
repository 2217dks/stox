const portfolioService = require("../services/portfolioService");

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
    const { portfolioId } = req.params;

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
    const { portfolioId } = req.params;

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
    const { portfolioId } = req.params;

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
    const { portfolioId } = req.params;

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

async function getCashBalance(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioId } = req.params;

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

module.exports = {
  listPortfolios,
  createPortfolio,
  getPortfolio,
  updatePortfolio,
  deletePortfolio,
  getPortfolioHoldings,
  getCashBalance,
};
