const { listAdminOrders } = require("../services/adminOrderService");

async function listOrders(req, res, next) {
  try {
    const result = await listAdminOrders(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listOrders,
};
