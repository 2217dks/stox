const copyTradingService = require("../services/copyTradingService");

async function listCopyTraders(req, res, next) {
  try {
    const result = await copyTradingService.listCopyTraders({
      userId: req.user.userId,
      ...req.validatedQuery,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function createCopyTrader(req, res, next) {
  try {
    const copyTrader = await copyTradingService.createCopyTrader({
      userId: req.user.userId,
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      data: {
        copyTrader,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCopyTrader(req, res, next) {
  try {
    const copyTrader = await copyTradingService.updateCopyTrader({
      userId: req.user.userId,
      copyTraderId: req.validatedParams.id,
      ...req.body,
    });

    return res.status(200).json({
      success: true,
      data: {
        copyTrader,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteCopyTrader(req, res, next) {
  try {
    const copyTrader = await copyTradingService.deleteCopyTrader({
      userId: req.user.userId,
      copyTraderId: req.validatedParams.id,
    });

    return res.status(200).json({
      success: true,
      data: {
        copyTrader,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listCopyTraders,
  createCopyTrader,
  updateCopyTrader,
  deleteCopyTrader,
};
