const {
  getGlobalLeaderboard,
  getFriendsLeaderboard,
  getLeaderboardHistory,
} = require("../services/leaderboardService");

async function global(req, res, next) {
  try {
    const result = await getGlobalLeaderboard(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function friends(req, res, next) {
  try {
    const result = await getFriendsLeaderboard(
      req.user.userId,
      req.validatedQuery,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function history(req, res, next) {
  try {
    const result = await getLeaderboardHistory(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  global,
  friends,
  history,
};
