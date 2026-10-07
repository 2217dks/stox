const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { validateParams } = require("../middleware/validation");
const {
  portfolioIdParamsSchema,
  updatePortfolioSchema,
} = require("../validators/portfolioValidator");
const portfolioController = require("../controllers/portfolioController");

const router = express.Router();

router.get("/", authMiddleware, portfolioController.listPortfolios);

router.post("/", authMiddleware, portfolioController.createPortfolio);

router.get(
  "/:portfolioId",
  authMiddleware,
  validateParams(portfolioIdParamsSchema),
  portfolioController.getPortfolio,
);

router.patch(
  "/:portfolioId",
  authMiddleware,
  validateParams(portfolioIdParamsSchema),
  validate(updatePortfolioSchema),
  portfolioController.updatePortfolio,
);

router.delete(
  "/:portfolioId",
  authMiddleware,
  validateParams(portfolioIdParamsSchema),
  portfolioController.deletePortfolio,
);

router.get(
  "/:portfolioId/holdings",
  authMiddleware,
  portfolioController.getPortfolioHoldings,
);

router.get(
  "/:portfolioId/cash-balance",
  authMiddleware,
  portfolioController.getCashBalance,
);

module.exports = router;
