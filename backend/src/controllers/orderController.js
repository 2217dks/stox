const orderService = require("../services/orderService");

async function createMarketOrder(req, res, next) {
  try {
    const order = await orderService.createMarketOrder({
      userId: req.user.userId,
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      data: {
        order,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createMarketOrder,
};
