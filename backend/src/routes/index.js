const express = require("express");

const authRoutes = require("./authRoutes");
const portfolioRoutes = require("./portfolioRoutes");
const orderRoutes = require("./orderRoutes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/portfolios", portfolioRoutes);
router.use("/orders", orderRoutes);

module.exports = router;
