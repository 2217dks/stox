const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

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

async function updatePortfolio(userId, portfolioId, { name, description } = {}) {
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

  return serializePortfolio(deactivatedPortfolio);
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

  return holdings.map((holding) => ({
    id: holding.id,
    portfolioId: holding.portfolioId,
    symbol: holding.symbol,
    assetType: holding.assetType,
    quantity: holding.quantity.toString(),
    averageBuyPrice: holding.averageBuyPrice.toString(),
    totalInvested: holding.totalInvested.toString(),
    isShort: holding.isShort,
    createdAt: holding.createdAt,
    updatedAt: holding.updatedAt,
  }));
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
  };
}

module.exports = {
  listUserPortfolios,
  getPortfolioById,
  createPortfolio,
  updatePortfolio,
  deactivatePortfolio,
  listPortfolioHoldings,
  getPortfolioCashBalance,
};
