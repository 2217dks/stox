const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { orderLimiter } = require("../middleware/rateLimiter");
const { createOrderSchema } = require("../validators/orderValidator");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  orderLimiter,
  validate(createOrderSchema),
  orderController.createOrder,
);

module.exports = router;
