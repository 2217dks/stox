const express = require("express");

const validate = require("../middleware/validation");
const { getCryptoQuote } = require("../controllers/marketController");
const { cryptoQuoteParamsSchema } = require("../validators/marketValidator");

const router = express.Router();

router.get(
  "/quote/:symbol",
  validate(cryptoQuoteParamsSchema, "params", "validatedParams"),
  getCryptoQuote,
);

module.exports = router;
