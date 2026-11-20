const jwt = require("jsonwebtoken");
const { AppError } = require("../utils/errors");
const prisma = require("../config/database");

require("dotenv").config();

async function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return next(AppError.unauthorized());
  }

  const [scheme, token] = authorization.split(" ");

  // RFC 7235 §2.1: the auth-scheme token is case-insensitive
  // ("bearer", "Bearer", "BEARER" are all valid).
  if (scheme.toLowerCase() !== "bearer" || !token) {
    return next(
      AppError.unauthorized("Invalid authorization header.", "INVALID_AUTH_HEADER"),
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { issuer: "stox" });
  } catch (error) {
    return next(AppError.unauthorized("Invalid or expired access token.", "INVALID_ACCESS_TOKEN"));
  }

  if (!decoded.userId) return next(AppError.unauthorized("Invalid access token.", "INVALID_ACCESS_TOKEN"));

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, email: true, isSuspended: true },
    });
    if (!user) return next(AppError.unauthorized("Invalid access token.", "INVALID_ACCESS_TOKEN"));
    if (user.isSuspended) return next(AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED"));
    req.user = { userId: user.id, role: user.role, email: user.email };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authMiddleware;
