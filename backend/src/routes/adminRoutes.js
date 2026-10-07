const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { requireRole } = require("../middleware/rbac");

const {
  adminUserListQuerySchema,
  adminUserParamsSchema,
} = require("../validators/adminUserValidator");

const adminUserController = require("../controllers/adminUserController");

const router = express.Router();

router.get(
  "/users",
  authMiddleware,
  requireRole("ADMIN"),
  validate(adminUserListQuerySchema, "query"),
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
