const express = require("express");

const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const portfolioRoutes = require("./portfolioRoutes");
const orderRoutes = require("./orderRoutes");

const {
  check: healthCheck,
} = require("../controllers/healthController");

const router = express.Router();

router.get("/health", healthCheck);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/portfolios", portfolioRoutes);
router.use("/orders", orderRoutes);

module.exports = router;
