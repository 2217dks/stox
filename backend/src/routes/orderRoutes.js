const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { orderLimiter } = require("../middleware/rateLimiter");
const {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} = require("../validators/orderValidator");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  orderLimiter,
  validate(createOrderSchema),
  orderController.createOrder,
);

router.get(
  "/",
  authMiddleware,
  validate(listOrdersQuerySchema, "query", "validatedQuery"),
  orderController.listOrders,
);

router.get(
  "/:id",
  authMiddleware,
  validate(orderIdParamSchema, "params"),
  orderController.getOrder,
);

module.exports = router;
