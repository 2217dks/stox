const prisma = require("../config/database");

function createServiceError(message, statusCode, code) {
  const error = new Error(message);

  error.statusCode = statusCode;
  error.code = code;

  return error;
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
  listPortfolioHoldings,
  getPortfolioCashBalance,
};
