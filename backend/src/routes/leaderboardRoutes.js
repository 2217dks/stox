const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  leaderboardQuerySchema,
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

module.exports = router;
