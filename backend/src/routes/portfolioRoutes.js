const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
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
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getPortfolio,
);

router.patch(
  "/:portfolioId",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(updatePortfolioSchema),
  portfolioController.updatePortfolio,
);

router.delete(
  "/:portfolioId",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.deletePortfolio,
);

router.get(
  "/:portfolioId/holdings",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getPortfolioHoldings,
);

router.get(
  "/:portfolioId/cash-balance",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getCashBalance,
);

module.exports = router;
