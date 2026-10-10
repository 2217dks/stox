const {
  getPreferences,
  updatePreferences,
} = require("../services/userPreferenceService");

/**
 * GET /api/v1/preferences
 *
 * Returns the authenticated user's notification preferences, creating default
 * preferences on first read.
 *
 * The user id is read from the verified access token (`req.user.userId`), so
 * the endpoint is always self-scoped and takes no user input.
 */
async function get(req, res, next) {
  try {
    const preferences = await getPreferences(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        preferences,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * PATCH /api/v1/preferences
 *
 * Updates the authenticated user's notification preferences. Only the fields
 * present in the validated body are written.
 */
async function update(req, res, next) {
  try {
    const preferences = await updatePreferences(req.user.userId, req.body);

    return res.status(200).json({
      success: true,
      data: {
        preferences,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  get,
  update,
};
