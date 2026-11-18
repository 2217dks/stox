const express = require("express");

const validate = require("../middleware/validation");
const {
  getCryptoQuote,
  getHistoricalPrices,
  getMarketOverview,
  searchMarketSymbols,
  getStockQuote,
} = require("../controllers/marketController");
const {
  cryptoQuoteParamsSchema,
  quoteQuerySchema,
  historicalPricesParamsSchema,
  historicalPricesQuerySchema,
  marketOverviewQuerySchema,
  marketSearchQuerySchema,
  stockQuoteParamsSchema,
} = require("../validators/marketValidator");

const router = express.Router();

router.get(
  "/search",
  validate(marketSearchQuerySchema, "query", "validatedQuery"),
  searchMarketSymbols,
);

router.get(
  "/quote/:symbol",
  validate(cryptoQuoteParamsSchema, "params", "validatedParams"),
  validate(quoteQuerySchema, "query", "validatedQuery"),
  getCryptoQuote,
);

router.get(
  "/quote/stock/:symbol",
  validate(stockQuoteParamsSchema, "params", "validatedParams"),
  validate(quoteQuerySchema, "query", "validatedQuery"),
  getStockQuote,
);

router.get(
  "/history/:symbol",
  validate(historicalPricesParamsSchema, "params", "validatedParams"),
  validate(historicalPricesQuerySchema, "query", "validatedQuery"),
  getHistoricalPrices,
);

router.get(
  "/overview",
  validate(marketOverviewQuerySchema, "query", "validatedQuery"),
  getMarketOverview,
);

module.exports = router;
