const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { requireRole } = require("../middleware/rbac");

const {
  adminUserListQuerySchema,
  adminUserParamsSchema,
  adminUserSuspensionSchema,
} = require("../validators/adminUserValidator");

const {
  adminOrderListQuerySchema,
} = require("../validators/adminOrderValidator");

const {
  adminPortfolioListQuerySchema,
  adminPortfolioParamsSchema,
} = require("../validators/adminPortfolioValidator");

const adminUserController = require("../controllers/adminUserController");
const adminOrderController = require("../controllers/adminOrderController");
const adminPortfolioController = require("../controllers/adminPortfolioController");

const router = express.Router();

router.get(
  "/orders",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminOrderListQuerySchema, "query", "validatedQuery"),
  adminOrderController.listOrders,
);

router.patch(
  "/users/:userId/suspend",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminUserParamsSchema, "params"),
  validate(adminUserSuspensionSchema),
  adminUserController.setUserSuspension,
);

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
