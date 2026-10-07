const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { orderLimiter } = require("../middleware/rateLimiter");
const { createMarketOrderSchema } = require("../validators/orderValidator");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  orderLimiter,
  validate(createMarketOrderSchema),
  orderController.createMarketOrder,
);

module.exports = router;
