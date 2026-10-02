const express = require("express");

const authRoutes = require("./authRoutes");
const portfolioRoutes = require("./portfolioRoutes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/portfolios", portfolioRoutes);

module.exports = router;
