const { Prisma } = require("@prisma/client");

const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const defaultOrderService = require("./orderService");

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const MONEY_SCALE = 8;
const DEFAULT_MAX_ATTEMPTS = 3;
// Followers are processed in id-ordered pages so a very large following does
// not load every relationship into memory at once.
const FAN_OUT_PAGE_SIZE = 200;
// Bounded concurrency: one slow follower must not serialize the whole page.
const FAN_OUT_CONCURRENCY = 10;

const TERMINAL_STATUSES = new Set(["PLACED", "FAILED", "SKIPPED"]);

// Failures that cannot be fixed by retrying the same source trade. They are
// recorded on the execution row for auditability and do not fail the job.
const PERMANENT_COPY_ERRORS = new Set([
  "ACCOUNT_SUSPENDED",
  "COPY_TRADING_PORTFOLIO_REQUIRED",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_POSITION",
  "INVALID_EXPIRES_AT",
  "INVALID_ORDER",
  "INVALID_ORDER_SOURCE",
  "INVALID_QUANTITY",
  "INVALID_RESERVATION_AMOUNT",
  "MARKET_DATA_INVALID_REQUEST",
  "MARKET_DATA_NOT_FOUND",
  "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
  "PORTFOLIO_INACTIVE",
  "PORTFOLIO_NOT_FOUND",
  "RESERVATION_AMOUNT_TOO_LARGE",
  "UNSUPPORTED_ASSET_TYPE",
  "USER_NOT_FOUND",
]);

/**
 * Size a copied order.
 *
 * `allocationPct` mirrors a fraction of the source quantity. `maxTradeSize` is
 * a notional (quote-currency) sizing cap, converted to a quantity at the source
 * trade price. The result is rounded DOWN to the storage scale so the quantity
 * implied by the source price never exceeds the cap.
 *
 * This is not a guarantee of the follower's final executed notional: copied
 * orders are MARKET orders, so the follower can fill at a different price. A
 * strict execution-notional cap would need a limit price or an execution-time
 * guard, which is a deliberate non-goal for this pipeline.
 */
function computeCopyQuantity({
  sourceQuantity,
  sourcePrice,
  allocationPct = "100",
  maxTradeSize = null,
}) {
  const quantity = new Prisma.Decimal(sourceQuantity);
  const allocation = new Prisma.Decimal(allocationPct ?? 100);
  const price = new Prisma.Decimal(sourcePrice);

  if (
    !quantity.isFinite() ||
    quantity.lte(ZERO) ||
    !allocation.isFinite() ||
    allocation.lte(ZERO)
  ) {
    return ZERO;
  }

  let copied = quantity.times(allocation).dividedBy(HUNDRED);

  if (maxTradeSize !== null && maxTradeSize !== undefined) {
    const cap = new Prisma.Decimal(maxTradeSize);

    if (cap.isFinite() && cap.gt(ZERO) && price.isFinite() && price.gt(ZERO)) {
      const capQuantity = cap.dividedBy(price);

      if (capQuantity.lt(copied)) {
        copied = capQuantity;
      }
    }
  }

  return copied.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_DOWN);
}

async function resolveCopyPortfolio(copyTrader) {
  if (copyTrader.copyPortfolioId) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: copyTrader.copyPortfolioId },
      select: { id: true, isActive: true },
    });

    if (!portfolio) {
      throw AppError.notFound(
        "Copy destination portfolio not found.",
        "PORTFOLIO_NOT_FOUND",
      );
    }

    if (!portfolio.isActive) {
      throw AppError.badRequest(
        "Copy destination portfolio is inactive.",
        "PORTFOLIO_INACTIVE",
      );
    }

    return portfolio;
  }

  // Legacy rows may have no explicit destination. Resolve the same default the
  // configuration API would have stored: default portfolio first, then oldest
  // active portfolio.
  const portfolio = await prisma.portfolio.findFirst({
    where: {
      userId: copyTrader.copierId,
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, isActive: true },
  });

  if (!portfolio) {
    throw AppError.badRequest(
      "No active portfolio is available for copied trades.",
      "COPY_TRADING_PORTFOLIO_REQUIRED",
    );
  }

  return portfolio;
}

async function loadSourceTrade(tradeId) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      order: {
        select: {
          id: true,
          source: true,
        },
      },
      portfolio: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!trade) {
    throw AppError.notFound(
      "Source trade not found.",
      "SOURCE_TRADE_NOT_FOUND",
    );
  }

  return trade;
}

async function createOrLoadExecution({ tradeId, copyTrader }) {
  try {
    return await prisma.copyTradeExecution.create({
      data: {
        sourceTradeId: tradeId,
        copierId: copyTrader.copierId,
        copyTraderId: copyTrader.id,
      },
    });
  } catch (error) {
    if (error.code !== "P2002") {
      throw error;
    }

    return prisma.copyTradeExecution.findUnique({
      where: {
        sourceTradeId_copierId: {
          sourceTradeId: tradeId,
          copierId: copyTrader.copierId,
        },
      },
    });
  }
}

function updateExecution(executionId, data) {
  return prisma.copyTradeExecution.update({
    where: { id: executionId },
    data,
  });
}

/**
 * Mark a trade as fanned out.
 *
 * The marker is what makes the recovery scan finite: a trade with no followers
 * still counts as processed, and a replay never copies a historical trade to a
 * follower added later.
 */
function markFanOutComplete(tradeId) {
  return prisma.trade.update({
    where: { id: tradeId },
    data: { copyFanOutAt: new Date() },
  });
}

/**
 * Find executed trades whose post-commit fan-out was never confirmed.
 *
 * The periodic scan re-enqueues these. Execution rows and the unique
 * `Order.copyTradeExecutionId` make a replay safe.
 */
async function scanUnprocessedCopyTrades({ limit = 100 } = {}) {
  return prisma.trade.findMany({
    where: { copyFanOutAt: null },
    select: { id: true },
    orderBy: [{ executedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}

function isPermanentCopyError(error) {
  return Boolean(error?.code && PERMANENT_COPY_ERRORS.has(error.code));
}

async function markPermanentFailure(execution, error) {
  return updateExecution(execution.id, {
    status: "FAILED",
    failureCode: error.code || "COPY_TRADE_FAILED",
    failureMessage: error.message || "Copied order failed.",
  });
}

/**
 * Attempt one follower.
 *
 * Returns one of:
 * - `placed`   the copied order exists (created now or recovered after a crash)
 * - `failed`   a permanent failure was recorded
 * - `skipped`  the execution is already terminal, or sizing produced zero
 * - `retryable` a transient failure was recorded and the caller should retry
 */
async function attemptFollower({
  trade,
  copyTrader,
  orderService,
  maxAttempts,
}) {
  const execution = await createOrLoadExecution({
    tradeId: trade.id,
    copyTrader,
  });

  if (!execution) {
    throw AppError.internal(
      "Unable to create the copy-trade execution row.",
      "COPY_TRADE_EXECUTION_FAILED",
    );
  }

  if (TERMINAL_STATUSES.has(execution.status)) {
    return { status: "skipped", execution };
  }

  // Recovery must run before the retry-budget check. If the order committed
  // but the worker crashed before marking the execution PLACED, the execution
  // may already be at the attempt limit. Marking it FAILED first would pair a
  // real copied order with a terminal failure row.
  const existingOrder = await prisma.order.findUnique({
    where: { copyTradeExecutionId: execution.id },
  });

  if (existingOrder) {
    const placed = await updateExecution(execution.id, {
      status: "PLACED",
      failureCode: null,
      failureMessage: null,
    });

    return { status: "placed", execution: placed, order: existingOrder };
  }

  if (execution.attempts >= maxAttempts) {
    const failed = await updateExecution(execution.id, {
      status: "FAILED",
      failureCode: "MAX_ATTEMPTS_EXCEEDED",
      failureMessage: `Copy-trade fan-out exceeded ${maxAttempts} attempts.`,
    });

    return { status: "failed", execution: failed };
  }

  let portfolio;

  try {
    portfolio = await resolveCopyPortfolio(copyTrader);
  } catch (error) {
    if (!isPermanentCopyError(error)) {
      throw error;
    }

    const failed = await markPermanentFailure(execution, error);
    return { status: "failed", execution: failed, error };
  }

  const quantity = computeCopyQuantity({
    sourceQuantity: trade.quantity,
    sourcePrice: trade.price,
    allocationPct: copyTrader.allocationPct,
    maxTradeSize: copyTrader.maxTradeSize,
  });

  if (quantity.lte(ZERO)) {
    const skipped = await updateExecution(execution.id, {
      status: "SKIPPED",
      failureCode: "ZERO_COPY_QUANTITY",
      failureMessage:
        "The configured allocation and maximum trade size produced a zero quantity.",
    });

    return { status: "skipped", execution: skipped };
  }

  const attempt = execution.attempts + 1;

  // Persist the attempt before placing the order. If the process crashes after
  // the order commits, the recovery lookup above finds it and marks PLACED.
  await updateExecution(execution.id, {
    attempts: attempt,
    failureCode: null,
    failureMessage: null,
  });

  try {
    const order = await orderService.createOrder({
      userId: copyTrader.copierId,
      portfolioId: portfolio.id,
      symbol: trade.symbol,
      assetType: trade.assetType,
      side: trade.side,
      type: "MARKET",
      quantity: quantity.toString(),
      source: "COPY_TRADE",
      copyTradeExecutionId: execution.id,
    });

    const placed = await updateExecution(execution.id, {
      status: "PLACED",
      failureCode: null,
      failureMessage: null,
    });

    return { status: "placed", execution: placed, order };
  } catch (error) {
    // A concurrent pass may have committed the order after the lookup above.
    // Never pair a live order with a FAILED execution: the terminal check would
    // then stop every later replay from repairing it.
    const racedOrder = await prisma.order.findUnique({
      where: { copyTradeExecutionId: execution.id },
    });

    if (racedOrder) {
      const placed = await updateExecution(execution.id, {
        status: "PLACED",
        failureCode: null,
        failureMessage: null,
      });

      return { status: "placed", execution: placed, order: racedOrder };
    }

    if (isPermanentCopyError(error) || attempt >= maxAttempts) {
      const failed = await updateExecution(execution.id, {
        status: "FAILED",
        failureCode:
          attempt >= maxAttempts && !isPermanentCopyError(error)
            ? "MAX_ATTEMPTS_EXCEEDED"
            : error.code || "COPY_TRADE_FAILED",
        failureMessage: error.message || "Copied order failed.",
      });

      return { status: "failed", execution: failed, error };
    }

    // Transient: leave the execution PENDING so the job retry can resume it.
    const pending = await updateExecution(execution.id, {
      failureCode: error.code || "COPY_TRADE_RETRY",
      failureMessage: error.message || "Copied order will be retried.",
    });

    return { status: "retryable", execution: pending, error };
  }
}

/**
 * Fan out one executed source trade to every active follower.
 *
 * The function is deliberately post-commit and per-follower isolated: a
 * failure on one follower never rolls back the source trade or blocks another
 * follower. Retryable failures are surfaced as a `COPY_TRADE_RETRY` error so
 * the BullMQ job can retry; the durable execution rows make the retry safe.
 */
async function fanOutCopyTrades({
  tradeId,
  orderService = defaultOrderService,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const trade = await loadSourceTrade(tradeId);

  const summary = {
    sourceTradeId: trade.id,
    eligible: 0,
    placed: 0,
    failed: 0,
    skipped: 0,
    retryable: 0,
  };

  // The recovery scan may race a still-running fan-out. The marker is the
  // durable "already processed" signal, so a second pass is a no-op.
  if (trade.copyFanOutAt) {
    summary.skipped = 1;
    summary.reason = "ALREADY_FANNED_OUT";
    return summary;
  }

  // Copying a copy trade would create chains and potential feedback loops.
  if (trade.order?.source === "COPY_TRADE") {
    await markFanOutComplete(trade.id);
    summary.skipped = 1;
    summary.reason = "COPY_TRADE_SOURCE";
    return summary;
  }

  const attempts =
    Number.isInteger(maxAttempts) && maxAttempts > 0
      ? maxAttempts
      : DEFAULT_MAX_ATTEMPTS;

  const retryableErrors = [];
  let cursor = null;

  do {
    const copyTraders = await prisma.copyTrader.findMany({
      where: {
        copiedId: trade.portfolio.userId,
        isActive: true,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: FAN_OUT_PAGE_SIZE,
    });

    if (copyTraders.length === 0) {
      break;
    }

    summary.eligible += copyTraders.length;

    for (let index = 0; index < copyTraders.length; index += FAN_OUT_CONCURRENCY) {
      const chunk = copyTraders.slice(index, index + FAN_OUT_CONCURRENCY);

      const results = await Promise.all(
        chunk.map(async (copyTrader) => {
          try {
            return await attemptFollower({
              trade,
              copyTrader,
              orderService,
              maxAttempts: attempts,
            });
          } catch (error) {
            // One follower's infrastructure failure must not stop the others.
            return { status: "error", error };
          }
        }),
      );

      for (const result of results) {
        if (result.status === "error" || result.status === "retryable") {
          summary.retryable += 1;
          retryableErrors.push(result.error);
          continue;
        }

        summary[result.status] += 1;
      }
    }

    cursor =
      copyTraders.length === FAN_OUT_PAGE_SIZE
        ? copyTraders[copyTraders.length - 1].id
        : null;
  } while (cursor);

  if (summary.retryable > 0) {
    // Every execution may have reached a terminal state even though one
    // follower's bookkeeping failed. Re-running the whole trade then only
    // replays already-terminal rows, so finish instead.
    const pending = await prisma.copyTradeExecution.count({
      where: {
        sourceTradeId: trade.id,
        status: { notIn: [...TERMINAL_STATUSES] },
      },
    });

    if (pending === 0) {
      await markFanOutComplete(trade.id);
      return summary;
    }

    const error = new Error(
      `Copy-trade fan-out has ${summary.retryable} retryable follower(s).`,
    );

    error.code = "COPY_TRADE_RETRY";
    error.details = {
      sourceTradeId: trade.id,
      retryable: summary.retryable,
      reasons: retryableErrors.map((item) => item?.code || "UNKNOWN"),
    };

    throw error;
  }

  await markFanOutComplete(trade.id);

  return summary;
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  computeCopyQuantity,
  fanOutCopyTrades,
  markFanOutComplete,
  scanUnprocessedCopyTrades,
};
