const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { createMarketOrderSchema } = require("../validators/orderValidator");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  validate(createMarketOrderSchema),
  orderController.createMarketOrder,
);

module.exports = router;
