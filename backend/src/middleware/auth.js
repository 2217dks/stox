const jwt = require("jsonwebtoken");
const { AppError } = require("../utils/errors");

require("dotenv").config();

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return next(AppError.unauthorized());
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(
      AppError.unauthorized("Invalid authorization header.", "INVALID_AUTH_HEADER"),
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      issuer: "stox",
    });

    if (!decoded.userId) {
      return next(
        AppError.unauthorized("Invalid access token.", "INVALID_ACCESS_TOKEN"),
      );
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (error) {
    return next(
      AppError.unauthorized(
        "Invalid or expired access token.",
        "INVALID_ACCESS_TOKEN",
      ),
    );
  }
}

module.exports = authMiddleware;
