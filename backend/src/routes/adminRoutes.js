const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { requireRole } = require("../middleware/rbac");

const {
  adminUserListQuerySchema,
  adminUserParamsSchema,
} = require("../validators/adminUserValidator");
const {
  adminPortfolioListQuerySchema,
  adminPortfolioParamsSchema,
} = require("../validators/adminPortfolioValidator");

const adminUserController = require("../controllers/adminUserController");
const adminPortfolioController = require("../controllers/adminPortfolioController");

const router = express.Router();

router.get(
  "/portfolios",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminPortfolioListQuerySchema, "query", "validatedQuery"),
  adminPortfolioController.listPortfolios,
);

router.get(
  "/portfolios/:portfolioId",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminPortfolioParamsSchema, "params", "validatedParams"),
  adminPortfolioController.getPortfolio,
);

router.get(
  "/users",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminUserListQuerySchema, "query", "validatedQuery"),
  adminUserController.listUsers,
);

router.get(
  "/users/:userId",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminUserParamsSchema, "params"),
  adminUserController.getUser,
);

module.exports = router;
