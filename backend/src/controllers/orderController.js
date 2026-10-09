const orderService = require("../services/orderService");

async function createOrder(req, res, next) {
  try {
    const order = await orderService.createOrder({
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
  createOrder,
};
