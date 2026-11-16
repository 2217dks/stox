const express = require("express");

const authMiddleware = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const achievementController = require("../controllers/achievementController");

const router = express.Router();

router.get("/", optionalAuth, achievementController.list);
router.get("/mine", authMiddleware, achievementController.mine);

module.exports = router;
