const { z } = require("zod");

const logger = require("../utils/logger");
const portfolioService = require("../services/portfolioService");
const { authenticateSocket } = require("./auth");
const { reply, handleEvent } = require("./socketHandlers");

const portfolioPayloadSchema = z.object({
  portfolioId: z.string().uuid("portfolioId must be a valid UUID."),
});

function normalizePayload(payload) {
  // Accept a bare string as well as `{ portfolioId }` so the shape used in
  // docs/REALTIME.md keeps working while the object form stays canonical.
  if (typeof payload === "string") {
    return { portfolioId: payload };
  }

  return payload && typeof payload === "object" ? payload : {};
}

function portfolioRoom(portfolioId) {
  return `portfolio:${portfolioId}`;
}

/**
 * Join a portfolio room only after proving the portfolio belongs to the
 * authenticated user.
 *
 * Room names are guessable (`portfolio:<uuid>`), so without this check any
 * authenticated client could subscribe to another user's portfolio events.
 * `getPortfolioById` is the same owner-scoped lookup the HTTP routes use, so a
 * foreign portfolio is indistinguishable from a missing one.
 */
async function joinPortfolio(socket, payload, ack) {
  const parsed = portfolioPayloadSchema.safeParse(normalizePayload(payload));

  if (!parsed.success) {
    reply(ack, {
      ok: false,
      code: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message || "Invalid portfolio ID.",
    });
    return;
  }

  const { portfolioId } = parsed.data;

  try {
    await portfolioService.getPortfolioById(
      socket.data.user.userId,
      portfolioId,
    );
  } catch (error) {
    reply(ack, {
      ok: false,
      code: error.code || "PORTFOLIO_NOT_FOUND",
      message: error.message,
    });
    return;
  }

  await socket.join(portfolioRoom(portfolioId));

  logger.info("Trading socket joined portfolio room", {
    socketId: socket.id,
    userId: socket.data.user.userId,
    portfolioId,
  });

  reply(ack, { ok: true, portfolioId });
}

async function leavePortfolio(socket, payload, ack) {
  const parsed = portfolioPayloadSchema.safeParse(normalizePayload(payload));

  if (!parsed.success) {
    reply(ack, {
      ok: false,
      code: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message || "Invalid portfolio ID.",
    });
    return;
  }

  const { portfolioId } = parsed.data;

  // Leaving is always safe and idempotent: no ownership lookup is needed
  // because a socket can only be in rooms it was allowed to join.
  await socket.leave(portfolioRoom(portfolioId));

  logger.info("Trading socket left portfolio room", {
    socketId: socket.id,
    userId: socket.data.user.userId,
    portfolioId,
  });

  reply(ack, { ok: true, portfolioId });
}

/**
 * `/trading` carries order execution and portfolio events.
 *
 * Every connection must be authenticated: a client that cannot prove who it is
 * has no business receiving portfolio data. The handshake middleware runs
 * before `connection`, so `socket.data.user` is always present here.
 */
function registerTradingNamespace(io) {
  const namespace = io.of("/trading");

  namespace.use(authenticateSocket);

  namespace.on("connection", (socket) => {
    const { userId } = socket.data.user;

    logger.info("Trading socket connected", {
      socketId: socket.id,
      userId,
    });

    handleEvent(socket, "join:portfolio", joinPortfolio);
    handleEvent(socket, "leave:portfolio", leavePortfolio);

    socket.on("disconnect", (reason) => {
      logger.info("Trading socket disconnected", {
        socketId: socket.id,
        userId,
        reason,
      });
    });
  });

  return namespace;
}

module.exports = {
  registerTradingNamespace,
  joinPortfolio,
  leavePortfolio,
};
