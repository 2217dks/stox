const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  listTradesQuerySchema,
  tradeIdParamSchema,
} = require("../validators/tradeValidator");
const tradeController = require("../controllers/tradeController");

const router = express.Router();

// Read-only resource: both endpoints sit under the global rate tier, like
// the order read routes. There is no state-changing trade endpoint.
router.get(
  "/",
  authMiddleware,
  validate(listTradesQuerySchema, "query", "validatedQuery"),
  tradeController.listTrades,
);

router.get(
  "/:id",
  authMiddleware,
  validate(tradeIdParamSchema, "params", "validatedParams"),
  tradeController.getTrade,
);

module.exports = router;
