const { AppError } = require("../utils/errors");

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }

    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden("Administrator access required."));
    }

    return next();
  };
}

module.exports = { requireRole };
