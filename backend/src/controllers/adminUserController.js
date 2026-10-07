const { listAdminUsers } = require("../services/adminUserService");

async function listUsers(req, res, next) {
  try {
    const result = await listAdminUsers(req.query);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
};
