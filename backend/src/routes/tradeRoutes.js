const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { tradeIdParamSchema } = require("../validators/tradeValidator");
const tradeController = require("../controllers/tradeController");

const router = express.Router();

// Read-only resource: endpoints sit under the global rate tier, like the
// order read routes. There is no state-changing trade endpoint.
router.get(
  "/:id",
  authMiddleware,
  validate(tradeIdParamSchema, "params", "validatedParams"),
  tradeController.getTrade,
);

module.exports = router;
