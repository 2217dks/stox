const marketDataService = require("../services/marketData");

async function getCryptoQuote(req, res, next) {
  try {
    const { symbol } = req.validatedParams;
    const quote = await marketDataService.getQuote(symbol, {
      assetClass: "CRYPTO",
    });

    return res.status(200).json({
      success: true,
      data: quote,
    });
  } catch (error) {
    return next(error);
  }
}

async function getHistoricalPrices(req, res, next) {
  try {
    const { symbol } = req.validatedParams;
    const prices = await marketDataService.getHistoricalPrices(
      symbol,
      req.validatedQuery,
    );

    return res.status(200).json({
      success: true,
      data: prices,
    });
  } catch (error) {
    return next(error);
  }
}

async function getMarketOverview(req, res, next) {
  try {
    const overview = await marketDataService.getMarketOverview(
      req.validatedQuery,
    );

    return res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getCryptoQuote, getHistoricalPrices, getMarketOverview };
