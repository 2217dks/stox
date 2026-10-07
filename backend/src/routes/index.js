const express = require("express");

const authRoutes = require("./authRoutes");
const portfolioRoutes = require("./portfolioRoutes");
const orderRoutes = require("./orderRoutes");
const adminRoutes = require("./adminRoutes");

const { check: healthCheck } = require("../controllers/healthController");

const router = express.Router();

router.get("/health", healthCheck);
router.use("/auth", authRoutes);
router.use("/portfolios", portfolioRoutes);
router.use("/orders", orderRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
