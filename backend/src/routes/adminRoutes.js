const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { requireRole } = require("../middleware/rbac");

const {
  adminUserListQuerySchema,
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

module.exports = router;
