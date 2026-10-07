const {
  getUserStatistics,
} = require("../services/userStatisticsService");

/**
 * GET /api/v1/users/me/statistics
 *
 * Returns trading statistics for the authenticated user.
 *
 * The user id is read from the verified access token (`req.user.userId`), so
 * the endpoint is always self-scoped and takes no user input.
 */
async function getMyStatistics(req, res, next) {
  try {
    const statistics = await getUserStatistics(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        statistics,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyStatistics,
};
