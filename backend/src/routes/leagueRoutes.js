const express = require("express");

const authMiddleware = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const validate = require("../middleware/validation");

const {
  createLeagueSchema,
  listLeaguesQuerySchema,
  joinLeagueSchema,
} = require("../validators/leagueValidator");

const leagueController = require("../controllers/leagueController");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  validate(createLeagueSchema),
  leagueController.create,
);

router.get(
  "/",
  optionalAuth,
  validate(listLeaguesQuerySchema, "query", "validatedQuery"),
  leagueController.list,
);

router.get(
  "/:id",
  optionalAuth,
  leagueController.getById,
);

router.post(
  "/:id/join",
  authMiddleware,
  validate(joinLeagueSchema),
  leagueController.join,
);

router.get(
  "/:id/leaderboard",
  optionalAuth,
  leagueController.leaderboard,
);

module.exports = router;

