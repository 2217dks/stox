const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

const ADMIN_PORTFOLIO_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  startingBalance: true,
  cashBalance: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

function serializeAdminPortfolio(portfolio) {
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
    owner: {
      id: portfolio.user.id,
      name: portfolio.user.name,
      email: portfolio.user.email,
    },
  };
}

function buildPortfolioWhere({ search, userId, isActive }) {
  const where = {};
  if (userId !== undefined) where.userId = userId;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { user: { is: { name: { contains: search, mode: "insensitive" } } } },
      { user: { is: { email: { contains: search, mode: "insensitive" } } } },
    ];
  }
  return where;
}

async function listAdminPortfolios({
  page = 1,
  limit = 20,
  search,
  userId,
  isActive,
}) {
  const where = buildPortfolioWhere({ search, userId, isActive });
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.portfolio.findMany({
      where,
      select: ADMIN_PORTFOLIO_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip,
      take: limit,
    }),
    prisma.portfolio.count({ where }),
  ]);

  return {
    portfolios: rows.map(serializeAdminPortfolio),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function getAdminPortfolioById(portfolioId) {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: ADMIN_PORTFOLIO_SELECT,
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  return serializeAdminPortfolio(portfolio);
}

module.exports = {
  getAdminPortfolioById,
  listAdminPortfolios,
  serializeAdminPortfolio,
};
