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

module.exports = {
  getTrade,
};
