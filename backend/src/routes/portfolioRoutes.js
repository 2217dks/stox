const express = require("express");

const authMiddleware = require("../middleware/auth");
const portfolioController = require("../controllers/portfolioController");

const router = express.Router();

router.get("/", authMiddleware, portfolioController.listPortfolios);

router.post("/", authMiddleware, portfolioController.createPortfolio);

router.get(
  "/:portfolioId/holdings",
  authMiddleware,
  portfolioController.getPortfolioHoldings,
);

module.exports = router;
