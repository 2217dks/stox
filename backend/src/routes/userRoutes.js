const express = require("express");

const {
  getMyStatistics,
  getPublicProfile,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const validate = require("../middleware/validation");
const { publicUserParamsSchema } = require("../validators/userValidator");

const router = express.Router();

// Self-scoped: the user id comes from the verified access token, never from the
// request, so no `:id` parameter is accepted here.
router.get("/me/statistics", authMiddleware, getMyStatistics);

router.get(
  "/:id",
  optionalAuth,
  validate(publicUserParamsSchema, "params"),
  getPublicProfile,
);

module.exports = router;
