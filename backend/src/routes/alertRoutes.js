const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");

const {
  createAlertSchema,
  updateAlertSchema,
  alertParamsSchema,
  listAlertsQuerySchema,
} = require("../validators/alertValidator");

const alertController = require("../controllers/alertController");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate(listAlertsQuerySchema, "query", "validatedQuery"),
  alertController.list,
);

router.post(
  "/",
  authMiddleware,
  validate(createAlertSchema),
  alertController.create,
);

router.patch(
  "/:alertId",
  authMiddleware,
  validate(alertParamsSchema, "params"),
  validate(updateAlertSchema),
  alertController.update,
);

router.delete(
  "/:alertId",
  authMiddleware,
  validate(alertParamsSchema, "params"),
  alertController.remove,
);

module.exports = router;
