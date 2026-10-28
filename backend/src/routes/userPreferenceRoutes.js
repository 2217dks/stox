const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  updatePreferencesSchema,
} = require("../validators/userPreferenceValidator");
const userPreferenceController = require("../controllers/userPreferenceController");

const router = express.Router();

// Self-scoped: the user id comes from the verified access token, never from the
// request, so no `:userId` parameter is accepted here.
router.get("/", authMiddleware, userPreferenceController.get);

router.patch(
  "/",
  authMiddleware,
  validate(updatePreferencesSchema),
  userPreferenceController.update,
);

module.exports = router;
