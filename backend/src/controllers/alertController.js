const {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
} = require("../services/alertService");

async function list(req, res, next) {
  try {
    const result = await listAlerts(req.user.userId, req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  try {
    const alert = await createAlert(req.user.userId, req.body);

    return res.status(201).json({
      success: true,
      data: {
        alert,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const { alertId } = req.params;

    const alert = await updateAlert(req.user.userId, alertId, req.body);

    return res.status(200).json({
      success: true,
      data: {
        alert,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const { alertId } = req.params;

    const result = await deleteAlert(req.user.userId, alertId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  list,
  create,
  update,
  remove,
};
