const express = require("express");

const authMiddleware = require("../middleware/auth");
const portfolioController = require("../controllers/portfolioController");

const router = express.Router();

router.get("/", authMiddleware, portfolioController.listPortfolios);

module.exports = router;
