const { Prisma } = require("@prisma/client");

const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

const cacheService = require("./cacheService");
const { getCanonicalInstrumentSymbol } = require("./symbolMappingService");

function createServiceError(message, statusCode, code) {
  return new AppError(message, { statusCode, code });
}

async function ensureActiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      isSuspended: true,
    },
  });

  if (!user) {
    throw createServiceError("User not found.", 404, "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw createServiceError("Account is suspended.", 403, "ACCOUNT_SUSPENDED");
  }

  return user;
}

function serializePortfolio(portfolio) {
  return {
    id: portfolio.id,
    userId: portfolio.userId,
    name: portfolio.name,
    description: portfolio.description,
    startingBalance: portfolio.startingBalance.toString(),
    cashBalance: portfolio.cashBalance.toString(),
    reservedCash: portfolio.reservedCash.toString(),
    availableCash: portfolio.cashBalance
      .minus(portfolio.reservedCash)
      .toString(),
    isDefault: portfolio.isDefault,
    isActive: portfolio.isActive,
    createdAt: portfolio.createdAt,
    updatedAt: portfolio.updatedAt,
  };
}

async function listUserPortfolios(userId) {
  await ensureActiveUser(userId);

  const portfolios = await prisma.portfolio.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        isDefault: "desc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return portfolios.map(serializePortfolio);
}

async function getPortfolioById(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  return serializePortfolio(portfolio);
}

async function createPortfolio(userId, { name, description = null }) {
  await ensureActiveUser(userId);

  const portfolioName = name?.trim();

  if (!portfolioName) {
    throw createServiceError(
      "Portfolio name is required.",
      400,
      "PORTFOLIO_NAME_REQUIRED",
    );
  }

  try {
    const portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: portfolioName,
        description:
          description === undefined ? null : description?.trim() || null,
        startingBalance: 10000,
        cashBalance: 10000,
        isDefault: false,
        isActive: true,
      },
    });

    return serializePortfolio(portfolio);
  } catch (error) {
    if (error?.code === "P2002") {
      throw createServiceError(
        "A portfolio with this name already exists.",
        409,
        "PORTFOLIO_NAME_EXISTS",
      );
    }

    throw error;
  }
}

async function updatePortfolio(
  userId,
  portfolioId,
  { name, description } = {},
) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  // Only user-editable fields are copied. Balance, ownership and lifecycle
  // flags (isDefault / isActive) are intentionally never updated here.
  const data = {};

  if (name !== undefined) {
    const portfolioName = name?.trim();

    if (!portfolioName) {
      throw createServiceError(
        "Portfolio name is required.",
        400,
        "PORTFOLIO_NAME_REQUIRED",
      );
    }

    data.name = portfolioName;
  }

  if (description !== undefined) {
    data.description =
      description === null ? null : description?.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return serializePortfolio(portfolio);
  }

  try {
    const updatedPortfolio = await prisma.portfolio.update({
      where: {
        id: portfolio.id,
      },
      data,
    });

    await Promise.all([
      cacheService.invalidatePortfolio(portfolio.id),
      cacheService.invalidatePortfolioAnalytics(portfolio.id),
      cacheService.invalidateUserAnalytics(portfolio.userId),
    ]);

    return serializePortfolio(updatedPortfolio);
  } catch (error) {
    if (error?.code === "P2002") {
      throw createServiceError(
        "A portfolio with this name already exists.",
        409,
        "PORTFOLIO_NAME_EXISTS",
      );
    }

    throw error;
  }
}

/**
 * Deactivate a portfolio (soft delete).
 *
 * Rows are never removed, so holdings, orders and trades stay intact and the
 * audit trail is preserved. The existing `isActive` flag is what the order
 * service already checks (PORTFOLIO_INACTIVE), so this is the safe delete.
 */
async function deactivatePortfolio(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  // The default/Main portfolio is protected: it must stay active.
  if (portfolio.isDefault) {
    throw createServiceError(
      "The default portfolio cannot be deleted.",
      409,
      "PORTFOLIO_DEFAULT",
    );
  }

  // Deactivation is idempotent.
  if (!portfolio.isActive) {
    await Promise.all([
      cacheService.invalidatePortfolio(portfolio.id),
      cacheService.invalidatePortfolioAnalytics(portfolio.id),
      cacheService.invalidateUserAnalytics(portfolio.userId),
    ]);
    return serializePortfolio(portfolio);
  }

  const deactivatedPortfolio = await prisma.portfolio.update({
    where: {
      id: portfolio.id,
    },
    data: {
      isActive: false,
    },
  });

  await Promise.all([
    cacheService.invalidatePortfolio(portfolio.id),
    cacheService.invalidatePortfolioAnalytics(portfolio.id),
    cacheService.invalidateUserAnalytics(portfolio.userId),
  ]);

  return serializePortfolio(deactivatedPortfolio);
}

/**
 * Reactivate a soft-deleted portfolio.
 *
 * Deactivation is reversible: holdings, orders and trades are preserved, so
 * restoring `isActive` makes the portfolio tradeable again. Idempotent, in the
 * same way as deactivation.
 */
async function reactivatePortfolio(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  const invalidateCaches = () =>
    Promise.all([
      cacheService.invalidatePortfolio(portfolio.id),
      cacheService.invalidatePortfolioAnalytics(portfolio.id),
      cacheService.invalidateUserAnalytics(portfolio.userId),
    ]);

  if (portfolio.isActive) {
    await invalidateCaches();
    return serializePortfolio(portfolio);
  }

  const reactivatedPortfolio = await prisma.portfolio.update({
    where: {
      id: portfolio.id,
    },
    data: {
      isActive: true,
    },
  });

  await invalidateCaches();

  return serializePortfolio(reactivatedPortfolio);
}

async function listPortfolioHoldings(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  const holdings = await prisma.holding.findMany({
    where: {
      portfolioId: portfolio.id,
    },
    orderBy: {
      symbol: "asc",
    },
  });

  const pendingSellOrders = await prisma.order.findMany({
    where: {
      portfolioId: portfolio.id,
      side: "SELL",
      status: "PENDING",
    },
    select: {
      symbol: true,
      assetType: true,
      quantity: true,
    },
  });

  const reservedMap = new Map();
  for (const pending of pendingSellOrders) {
    const canonical = getCanonicalInstrumentSymbol(
      pending.symbol,
      pending.assetType,
    );
    const key = `${pending.assetType}:${canonical}`;
    const prev = reservedMap.get(key) || new Prisma.Decimal(0);
    reservedMap.set(key, prev.plus(new Prisma.Decimal(pending.quantity)));
  }

  const remainingReservedMap = new Map();
  for (const [key, val] of reservedMap.entries()) {
    remainingReservedMap.set(key, new Prisma.Decimal(val));
  }

  return holdings.map((holding) => {
    const canonical = getCanonicalInstrumentSymbol(
      holding.symbol,
      holding.assetType,
    );
    const key = `${holding.assetType}:${canonical}`;
    const unallocated = remainingReservedMap.get(key) || new Prisma.Decimal(0);
    const heldQty = new Prisma.Decimal(holding.quantity);
    const rowReserved = heldQty.gt(unallocated) ? unallocated : heldQty;
    remainingReservedMap.set(key, unallocated.minus(rowReserved));
    const availableQty = heldQty.gt(rowReserved)
      ? heldQty.minus(rowReserved)
      : new Prisma.Decimal(0);

    return {
      id: holding.id,
      portfolioId: holding.portfolioId,
      symbol: holding.symbol,
      assetType: holding.assetType,
      quantity: holding.quantity.toString(),
      reservedQuantity: rowReserved.toString(),
      availableQuantity: availableQty.toString(),
      averageBuyPrice: holding.averageBuyPrice.toString(),
      totalInvested: holding.totalInvested.toString(),
      isShort: holding.isShort,
      createdAt: holding.createdAt,
      updatedAt: holding.updatedAt,
    };
  });
}

/**
 * Portfolio summary for a single, caller-owned portfolio.
 *
 * Reuses the shared ownership check and serializer so the summary can never
 * expose another user's portfolio and always matches the portfolio shape used
 * by the list/create endpoints.
 *
 * Phase 1 has no market prices, so `holdingsValue` is the invested cost basis
 * of the open positions (the sum of Holding.totalInvested) rather than a live
 * market valuation. `totalValue` is cash plus that invested value. Market
 * valuation, returns and P&L live in the Phase 2 analytics endpoints.
 */
async function getPortfolioSummary(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  return cacheService.getOrSetPortfolioSummary(portfolioId, async () => {
    const holdingsAggregate = await prisma.holding.aggregate({
      where: {
        portfolioId: portfolio.id,
      },
      _count: true,
      _sum: {
        totalInvested: true,
      },
    });

    const holdingsValue =
      holdingsAggregate._sum.totalInvested ?? new Prisma.Decimal(0);

    const totalValue = portfolio.cashBalance.plus(holdingsValue);

    return {
      ...serializePortfolio(portfolio),
      holdingsValue: holdingsValue.toString(),
      totalValue: totalValue.toString(),
      holdingsCount: holdingsAggregate._count,
    };
  });
}

/**
 * Internal, non-request-scoped valuation used by realtime portfolio updates.
 *
 * It takes only a portfolio id and performs no ownership or active-user check,
 * so it must never be exposed directly by a route. `pnl` is account-level
 * performance against the starting balance, using invested cost basis for open
 * positions (Phase 2 market valuation is a separate concern).
 */
async function getPortfolioValuation(portfolioId) {
  const [portfolio, aggregate] = await Promise.all([
    prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: {
        id: true,
        cashBalance: true,
        startingBalance: true,
      },
    }),
    prisma.holding.aggregate({
      where: { portfolioId },
      _sum: {
        totalInvested: true,
      },
    }),
  ]);

  if (!portfolio) {
    return null;
  }

  const holdingsValue = aggregate._sum.totalInvested ?? new Prisma.Decimal(0);
  const totalValue = portfolio.cashBalance.plus(holdingsValue);
  const pnl = totalValue.minus(portfolio.startingBalance);

  return {
    portfolioId: portfolio.id,
    cashBalance: portfolio.cashBalance.toString(),
    holdingsValue: holdingsValue.toString(),
    totalValue: totalValue.toString(),
    pnl: pnl.toString(),
    asOf: new Date().toISOString(),
  };
}

async function getPortfolioCashBalance(userId, portfolioId) {
  await ensureActiveUser(userId);

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      cashBalance: true,
      reservedCash: true,
    },
  });

  if (!portfolio) {
    throw createServiceError(
      "Portfolio not found.",
      404,
      "PORTFOLIO_NOT_FOUND",
    );
  }

  return {
    portfolioId: portfolio.id,
    cashBalance: portfolio.cashBalance.toString(),
    reservedCash: portfolio.reservedCash.toString(),
    availableCash: portfolio.cashBalance
      .minus(portfolio.reservedCash)
      .toString(),
  };
}

module.exports = {
  listUserPortfolios,
  getPortfolioById,
  createPortfolio,
  updatePortfolio,
  deactivatePortfolio,
  reactivatePortfolio,
  listPortfolioHoldings,
  getPortfolioCashBalance,
  getPortfolioSummary,
  getPortfolioValuation,
};
