const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

const COPY_TRADER_INCLUDE = {
  copied: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
    },
  },
  copyPortfolio: {
    select: {
      id: true,
      name: true,
    },
  },
};

function serializeCopyTrader(copyTrader) {
  return {
    id: copyTrader.id,
    copierId: copyTrader.copierId,
    traderId: copyTrader.copiedId,
    trader: copyTrader.copied
      ? {
          id: copyTrader.copied.id,
          name: copyTrader.copied.name,
          avatarUrl: copyTrader.copied.avatarUrl,
        }
      : null,
    copyPortfolioId: copyTrader.copyPortfolioId,
    copyPortfolio: copyTrader.copyPortfolio
      ? {
          id: copyTrader.copyPortfolio.id,
          name: copyTrader.copyPortfolio.name,
        }
      : null,
    allocationPct: copyTrader.allocationPct.toString(),
    maxTradeSize: copyTrader.maxTradeSize
      ? copyTrader.maxTradeSize.toString()
      : null,
    isActive: copyTrader.isActive,
    createdAt: copyTrader.createdAt,
    updatedAt: copyTrader.updatedAt,
  };
}

async function ensureActiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isSuspended: true },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  return user;
}

async function findTargetTrader(traderId) {
  const trader = await prisma.user.findUnique({
    where: { id: traderId },
    select: {
      id: true,
      isSuspended: true,
    },
  });

  if (!trader) {
    throw AppError.notFound("Trader not found.", "USER_NOT_FOUND");
  }

  if (trader.isSuspended) {
    throw AppError.badRequest(
      "Cannot copy a suspended trader.",
      "USER_SUSPENDED",
    );
  }

  return trader;
}

async function resolveDestinationPortfolio(userId, copyPortfolioId) {
  if (copyPortfolioId) {
    const portfolio = await prisma.portfolio.findFirst({
      where: {
        id: copyPortfolioId,
        userId,
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!portfolio) {
      throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
    }

    if (!portfolio.isActive) {
      throw AppError.badRequest(
        "Portfolio is inactive.",
        "PORTFOLIO_INACTIVE",
      );
    }

    return portfolio;
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: {
      userId,
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.badRequest(
      "An active portfolio is required to copy trades.",
      "COPY_TRADING_PORTFOLIO_REQUIRED",
    );
  }

  return portfolio;
}

async function listCopyTraders({
  userId,
  page = 1,
  limit = 20,
  isActive,
}) {
  await ensureActiveUser(userId);

  const where = { copierId: userId };

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const [copyTraders, total] = await Promise.all([
    prisma.copyTrader.findMany({
      where,
      include: COPY_TRADER_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.copyTrader.count({ where }),
  ]);

  return {
    copyTraders: copyTraders.map(serializeCopyTrader),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function createCopyTrader({
  userId,
  traderId,
  allocationPct = "100",
  maxTradeSize = null,
  copyPortfolioId = null,
  isActive = true,
}) {
  await ensureActiveUser(userId);

  if (traderId === userId) {
    throw AppError.badRequest(
      "You cannot copy yourself.",
      "COPY_TRADING_SELF_REFERENCE",
    );
  }

  await findTargetTrader(traderId);

  const portfolio = await resolveDestinationPortfolio(
    userId,
    copyPortfolioId,
  );

  try {
    const copyTrader = await prisma.copyTrader.create({
      data: {
        copierId: userId,
        copiedId: traderId,
        copyPortfolioId: portfolio.id,
        allocationPct,
        maxTradeSize,
        isActive,
      },
      include: COPY_TRADER_INCLUDE,
    });

    return serializeCopyTrader(copyTrader);
  } catch (error) {
    if (error.code === "P2002") {
      throw AppError.conflict(
        "This trader is already configured for copy trading.",
        "COPY_TRADING_ALREADY_EXISTS",
      );
    }

    throw error;
  }
}

async function updateCopyTrader({
  userId,
  copyTraderId,
  allocationPct,
  maxTradeSize,
  copyPortfolioId,
  isActive,
}) {
  await ensureActiveUser(userId);

  const existing = await prisma.copyTrader.findFirst({
    where: {
      id: copyTraderId,
      copierId: userId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw AppError.notFound(
      "Copy-trading relationship not found.",
      "COPY_TRADING_NOT_FOUND",
    );
  }

  const data = {};

  if (allocationPct !== undefined) {
    data.allocationPct = allocationPct;
  }

  if (maxTradeSize !== undefined) {
    data.maxTradeSize = maxTradeSize;
  }

  if (isActive !== undefined) {
    data.isActive = isActive;
  }

  if (copyPortfolioId !== undefined) {
    if (copyPortfolioId === null) {
      data.copyPortfolioId = null;
    } else {
      const portfolio = await resolveDestinationPortfolio(
        userId,
        copyPortfolioId,
      );
      data.copyPortfolioId = portfolio.id;
    }
  }

  const copyTrader = await prisma.copyTrader.update({
    where: { id: copyTraderId },
    data,
    include: COPY_TRADER_INCLUDE,
  });

  return serializeCopyTrader(copyTrader);
}

async function deleteCopyTrader({ userId, copyTraderId }) {
  await ensureActiveUser(userId);

  const existing = await prisma.copyTrader.findFirst({
    where: {
      id: copyTraderId,
      copierId: userId,
    },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!existing) {
    throw AppError.notFound(
      "Copy-trading relationship not found.",
      "COPY_TRADING_NOT_FOUND",
    );
  }

  // Soft delete: the relationship row and its history are retained, but the
  // fan-out query only selects active rows. Repeating the request is a no-op.
  const copyTrader =
    existing.isActive === false
      ? await prisma.copyTrader.findUnique({
          where: { id: copyTraderId },
          include: COPY_TRADER_INCLUDE,
        })
      : await prisma.copyTrader.update({
          where: { id: copyTraderId },
          data: { isActive: false },
          include: COPY_TRADER_INCLUDE,
        });

  if (!copyTrader) {
    throw AppError.notFound(
      "Copy-trading relationship not found.",
      "COPY_TRADING_NOT_FOUND",
    );
  }

  return serializeCopyTrader(copyTrader);
}

module.exports = {
  COPY_TRADER_INCLUDE,
  serializeCopyTrader,
  listCopyTraders,
  createCopyTrader,
  updateCopyTrader,
  deleteCopyTrader,
};
