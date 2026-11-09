const authMiddleware = require("./auth");

function optionalAuth(req, res, next) {
  if (!req.headers.authorization) {
    return next();
  }

  return authMiddleware(req, res, next);
}

module.exports = optionalAuth;
