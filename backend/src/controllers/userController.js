const {
  getUserStatistics,
  getMonthlyTradeStatistics,
} = require("../services/userStatisticsService");
const {
  getPublicProfile: getPublicSocialProfile,
} = require("../services/socialService");

/**
 * GET /api/v1/users/me/statistics
 *
 * Returns trading statistics for the authenticated user, optionally filtered
 * by portfolio, symbol, side, date range, or including monthly breakdown.
 *
 * The user id is read from the verified access token (`req.user.userId`), so
 * the endpoint is always self-scoped and takes no user id parameter.
 */
async function getMyStatistics(req, res, next) {
  try {
    const filters = req.validatedQuery ?? req.query ?? {};
    const statistics = await getUserStatistics(req.user.userId, filters);

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

async function getMyMonthlyStatistics(req, res, next) {
  try {
    const filters = req.validatedQuery ?? req.query ?? {};
    const monthly = await getMonthlyTradeStatistics(req.user.userId, filters);

    return res.status(200).json({
      success: true,
      data: {
        monthly,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPublicProfile(req, res, next) {
  try {
    const user = await getPublicSocialProfile(req.params.id, req.user?.userId);

    return res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyStatistics,
  getMyMonthlyStatistics,
  getPublicProfile,
};
