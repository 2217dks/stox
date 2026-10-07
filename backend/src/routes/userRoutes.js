const express = require("express");

const { getMyStatistics } = require("../controllers/userController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// Self-scoped: the user id comes from the verified access token, never from the
// request, so no `:id` parameter is accepted here.
router.get("/me/statistics", authMiddleware, getMyStatistics);

module.exports = router;
