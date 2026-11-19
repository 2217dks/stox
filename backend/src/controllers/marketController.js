const marketDataService = require("../services/marketData");

async function getCryptoQuote(req, res, next) {
  try {
    const { symbol } = req.validatedParams;
    const quote = await marketDataService.getQuote(symbol, {
      assetClass: "CRYPTO",
      ...(req.validatedQuery || {}),
    });

    if (quote.freshness) {
      res.setHeader("X-Quote-Freshness", quote.freshness);
    }
    if (quote.ageSeconds !== null && quote.ageSeconds !== undefined) {
      res.setHeader("X-Quote-Age-Seconds", String(quote.ageSeconds));
    }

    return res.status(200).json({
      success: true,
      data: quote,
    });
  } catch (error) {
    return next(error);
  }
}

async function getStockQuote(req, res, next) {
  try {
    const { symbol } = req.validatedParams;
    const quote = await marketDataService.getQuote(symbol, {
      assetClass: "STOCK",
      ...(req.validatedQuery || {}),
    });

    if (quote.freshness) {
      res.setHeader("X-Quote-Freshness", quote.freshness);
    }
    if (quote.ageSeconds !== null && quote.ageSeconds !== undefined) {
      res.setHeader("X-Quote-Age-Seconds", String(quote.ageSeconds));
    }

    return res.status(200).json({
      success: true,
      data: quote,
    });
  } catch (error) {
    return next(error);
  }
}

async function getQuotes(req, res, next) {
  try {
    const { symbols } = req.validatedQuery;
    const quotes = await marketDataService.getQuotes(symbols);

    return res.status(200).json({
      success: true,
      data: { quotes },
    });
  } catch (error) {
    return next(error);
  }
}

async function searchMarketSymbols(req, res, next) {
  try {
    const { query, ...options } = req.validatedQuery;
    const results = await marketDataService.searchSymbols(query, options);

    return res.status(200).json({
      success: true,
      data: results,
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

module.exports = {
  getCryptoQuote,
  getHistoricalPrices,
  getMarketOverview,
  searchMarketSymbols,
  getStockQuote,
  getQuotes,
};
