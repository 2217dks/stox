const {
  listAdminUsers,
  getAdminUserById,
} = require("../services/adminUserService");

async function listUsers(req, res, next) {
  try {
    const result = await listAdminUsers(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const { userId } = req.params;

    const user = await getAdminUserById(userId);

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
  listUsers,
  getUser,
};
