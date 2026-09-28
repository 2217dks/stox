const express = require("express");

const {
  register,
  login,
  refresh,
  logout,
  google,
  currentUser,
} = require("../controllers/authController");

const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/google", google);

router.get("/me", authMiddleware, currentUser);

module.exports = router;
