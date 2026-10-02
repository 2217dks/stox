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

module.exports = {
  listPortfolios,
  createPortfolio,
};
