const express = require("express");

const validate = require("../middleware/validation");
const {
  getCryptoQuote,
  getHistoricalPrices,
} = require("../controllers/marketController");
const {
  cryptoQuoteParamsSchema,
  historicalPricesParamsSchema,
  historicalPricesQuerySchema,
} = require("../validators/marketValidator");

const router = express.Router();

router.get(
  "/quote/:symbol",
  validate(cryptoQuoteParamsSchema, "params", "validatedParams"),
  getCryptoQuote,
);

router.get(
  "/history/:symbol",
  validate(historicalPricesParamsSchema, "params", "validatedParams"),
  validate(historicalPricesQuerySchema, "query", "validatedQuery"),
  getHistoricalPrices,
);

module.exports = router;
