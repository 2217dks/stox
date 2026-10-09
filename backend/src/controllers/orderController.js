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

async function getOrder(req, res, next) {
  try {
    const order = await orderService.getOrder({
      userId: req.user.userId,
      orderId: req.params.id,
    });

    return res.status(200).json({
      success: true,
      data: {
        order,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listOrders(req, res, next) {
  try {
    const result = await orderService.listOrders({
      userId: req.user.userId,
      ...req.validatedQuery,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function cancelOrder(req, res, next) {
  try {
    const order = await orderService.cancelOrder({
      userId: req.user.userId,
      orderId: req.params.id,
    });

    return res.status(200).json({
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
  getOrder,
  listOrders,
  cancelOrder,
};
