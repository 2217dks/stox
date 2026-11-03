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

module.exports = { getCryptoQuote };
