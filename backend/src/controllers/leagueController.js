const {
  createLeague,
  listLeagues,
  getLeagueById,
  joinLeague,
  getLeagueLeaderboard,
} = require("../services/competitionService");

async function create(req, res, next) {
  try {
    const league = await createLeague(req.body);
    return res.status(201).json({
      success: true,
      data: {
        league,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const query = req.validatedQuery || req.query;
    const result = await listLeagues(query);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const league = await getLeagueById(req.params.id);
    return res.status(200).json({
      success: true,
      data: {
        league,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function join(req, res, next) {
  try {
    const member = await joinLeague({
      leagueId: req.params.id,
      userId: req.user.userId,
      portfolioId: req.body?.portfolioId,
    });
    return res.status(200).json({
      success: true,
      data: {
        member,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function leaderboard(req, res, next) {
  try {
    const result = await getLeagueLeaderboard({
      leagueId: req.params.id,
    });
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  create,
  list,
  getById,
  join,
  leaderboard,
};

