const { recordVote, getSentiment } = require("../services/sentimentService");

async function vote(req, res, next) {
  try {
    const { symbol } = req.params;
    const { sentiment } = req.body;

    const vote = await recordVote({
      userId: req.user.userId,
      symbol,
      sentiment,
    });

    return res.status(200).json({
      success: true,
      data: {
        vote,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  try {
    const { symbol } = req.params;
    const { window } = req.validatedQuery || {};

    const sentiment = await getSentiment({
      symbol,
      window,
      viewerId: req.user?.userId ?? null,
    });

    return res.status(200).json({
      success: true,
      data: sentiment,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  vote,
  get,
};

