const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function rateLimitedResponse(req, res) {
  return res.status(429).json({
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
    },
  });
}

const commonOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedResponse,
};

const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: envInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  limit: envInt("RATE_LIMIT_GLOBAL_MAX", 100),
});

const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: envInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  limit: envInt("RATE_LIMIT_AUTH_MAX", 10),
});

const orderLimiter = rateLimit({
  ...commonOptions,
  windowMs: envInt("RATE_LIMIT_ORDER_WINDOW_MS", 60 * 1000),
  limit: envInt("RATE_LIMIT_ORDER_MAX", 30),
  keyGenerator: (req) => {
    if (req.user?.userId) {
      return req.user.userId;
    }
    return ipKeyGenerator(req.ip);
  },
});

module.exports = { globalLimiter, authLimiter, orderLimiter };
