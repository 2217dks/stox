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
  getCryptoQuote,
);

router.get(
  "/quote/stock/:symbol",
  validate(stockQuoteParamsSchema, "params", "validatedParams"),
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
