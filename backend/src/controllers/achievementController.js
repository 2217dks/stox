const {
  listAchievements,
  listUserAchievements,
} = require("../services/achievementService");

async function list(req, res, next) {
  try {
    const achievements = await listAchievements();
    return res.status(200).json({
      success: true,
      data: {
        achievements,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function mine(req, res, next) {
  try {
    const achievements = await listUserAchievements(req.user.userId);
    return res.status(200).json({
      success: true,
      data: {
        achievements,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  list,
  mine,
};
