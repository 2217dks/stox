const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../services/notificationService");

async function list(req, res, next) {
  try {
    const result = await listNotifications(req.user.userId, req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function markRead(req, res, next) {
  try {
    const { notificationId } = req.params;

    const notification = await markNotificationRead(
      req.user.userId,
      notificationId,
    );

    return res.status(200).json({
      success: true,
      data: {
        notification,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function markAllRead(req, res, next) {
  try {
    const result = await markAllNotificationsRead(req.user.userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  list,
  markRead,
  markAllRead,
};
