const express = require("express");

const {
  register,
  login,
  refresh,
  logout,
  google,
  currentUser,
  updateCurrentUser,
} = require("../controllers/authController");

const {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  googleLoginSchema,
  updateProfileSchema,
} = require("../validators/authValidator");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const { authLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", authLimiter, validate(refreshTokenSchema), refresh);
router.post("/logout", validate(refreshTokenSchema), logout);
router.post("/google", validate(googleLoginSchema), google);
router.get("/me", authMiddleware, currentUser);
router.patch(
  "/profile",
  authMiddleware,
  validate(updateProfileSchema),
  updateCurrentUser,
);

module.exports = router;
