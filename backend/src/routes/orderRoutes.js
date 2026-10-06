const express = require("express");

const authMiddleware = require("../middleware/auth");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.post("/", authMiddleware, orderController.createMarketOrder);

module.exports = router;
