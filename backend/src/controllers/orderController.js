const orderService = require("../services/orderService");
const { createMarketOrderSchema } = require("../validators/orderValidator");

function createValidationError(message, details) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = details;
  return error;
}

async function createMarketOrder(req, res, next) {
  try {
    const result = createMarketOrderSchema.safeParse(req.body);

    if (!result.success) {
      return next(
        createValidationError(
          "Invalid market order request.",
          result.error.flatten(),
        ),
      );
    }

    const order = await orderService.createMarketOrder({
      userId: req.user.userId,
      ...result.data,
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
