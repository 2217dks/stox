const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  createCopyTraderSchema,
  updateCopyTraderSchema,
  copyTraderIdParamSchema,
  listCopyTradersQuerySchema,
} = require("../validators/copyTradingValidator");
const copyTradingController = require("../controllers/copyTradingController");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate(listCopyTradersQuerySchema, "query", "validatedQuery"),
  copyTradingController.listCopyTraders,
);

router.post(
  "/",
  authMiddleware,
  validate(createCopyTraderSchema),
  copyTradingController.createCopyTrader,
);

router.patch(
  "/:id",
  authMiddleware,
  validate(copyTraderIdParamSchema, "params", "validatedParams"),
  validate(updateCopyTraderSchema),
  copyTradingController.updateCopyTrader,
);

router.delete(
  "/:id",
  authMiddleware,
  validate(copyTraderIdParamSchema, "params", "validatedParams"),
  copyTradingController.deleteCopyTrader,
);

module.exports = router;
