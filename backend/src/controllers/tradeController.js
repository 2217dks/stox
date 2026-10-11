const tradeService = require("../services/tradeService");

async function getTrade(req, res, next) {
  try {
    const trade = await tradeService.getTrade({
      userId: req.user.userId,
      tradeId: req.validatedParams.id,
    });

    return res.status(200).json({
      success: true,
      data: {
        trade,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listTrades(req, res, next) {
  try {
    const result = await tradeService.listTrades({
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

module.exports = {
  getTrade,
  listTrades,
};
