const {
  getAdminPortfolioById,
  listAdminPortfolios,
} = require("../services/adminPortfolioService");

async function listPortfolios(req, res, next) {
  try {
    const result = await listAdminPortfolios(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getPortfolio(req, res, next) {
  try {
    const { portfolioId } = req.validatedParams;
    const portfolio = await getAdminPortfolioById(portfolioId);

    return res.status(200).json({
      success: true,
      data: { portfolio },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getPortfolio, listPortfolios };
