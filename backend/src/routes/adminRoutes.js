const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { requireRole } = require("../middleware/rbac");

const {
  adminUserListQuerySchema,
  adminUserParamsSchema,
} = require("../validators/adminUserValidator");
const {
  adminOrderListQuerySchema,
} = require("../validators/adminOrderValidator");

const adminUserController = require("../controllers/adminUserController");
const adminOrderController = require("../controllers/adminOrderController");

const router = express.Router();

router.get(
  "/orders",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminOrderListQuerySchema, "query", "validatedQuery"),
  adminOrderController.listOrders,
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
