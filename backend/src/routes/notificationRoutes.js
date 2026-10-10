const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");

const {
  notificationParamsSchema,
  listNotificationsQuerySchema,
} = require("../validators/notificationValidator");

const notificationController = require("../controllers/notificationController");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate(listNotificationsQuerySchema, "query", "validatedQuery"),
  notificationController.list,
);

router.patch(
  "/read-all",
  authMiddleware,
  notificationController.markAllRead,
);

router.patch(
  "/:notificationId/read",
  authMiddleware,
  validate(notificationParamsSchema, "params"),
  notificationController.markRead,
);

module.exports = router;
