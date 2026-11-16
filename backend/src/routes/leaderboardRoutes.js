const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  leaderboardQuerySchema,
  leaderboardHistoryQuerySchema,
} = require("../validators/leaderboardValidator");
const leaderboardController = require("../controllers/leaderboardController");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate(leaderboardQuerySchema, "query", "validatedQuery"),
  leaderboardController.global,
);

router.get(
  "/friends",
  authMiddleware,
  validate(leaderboardQuerySchema, "query", "validatedQuery"),
  leaderboardController.friends,
);

router.get(
  "/history",
  authMiddleware,
  validate(leaderboardHistoryQuerySchema, "query", "validatedQuery"),
  leaderboardController.history,
);

module.exports = router;
