const express = require("express");

const authMiddleware = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const validate = require("../middleware/validation");

const {
  symbolParamsSchema,
  voteSentimentSchema,
  sentimentQuerySchema,
} = require("../validators/sentimentValidator");

const sentimentController = require("../controllers/sentimentController");

const router = express.Router();

router.post(
  "/:symbol/vote",
  authMiddleware,
  validate(symbolParamsSchema, "params"),
  validate(voteSentimentSchema),
  sentimentController.vote,
);

router.get(
  "/:symbol",
  optionalAuth,
  validate(symbolParamsSchema, "params"),
  validate(sentimentQuerySchema, "query", "validatedQuery"),
  sentimentController.get,
);

module.exports = router;
