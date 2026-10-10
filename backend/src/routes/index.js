const express = require("express");

const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const portfolioRoutes = require("./portfolioRoutes");
const orderRoutes = require("./orderRoutes");
const alertRoutes = require("./alertRoutes");
const notificationRoutes = require("./notificationRoutes");
const socialRoutes = require("./socialRoutes");
const leaderboardRoutes = require("./leaderboardRoutes");
const adminRoutes = require("./adminRoutes");

const { check: healthCheck } = require("../controllers/healthController");

const router = express.Router();

router.get("/health", healthCheck);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/portfolios", portfolioRoutes);
router.use("/orders", orderRoutes);
router.use("/alerts", alertRoutes);
router.use("/notifications", notificationRoutes);
router.use("/social", socialRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
