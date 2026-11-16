const prisma = require("../config/database");
const { Prisma } = require("@prisma/client");
const { enqueueNotificationDelivery } = require("../queues/notificationQueue");
const { calculatePortfolioValuation } = require("./portfolioValuationService");
const logger = require("../utils/logger");

const CATALOG = [
  {
    code: "FIRST_TRADE",
    name: "First Trade",
    description: "Executed your first trade.",
    category: "TRADING",
    criteria: { totalTrades: 1 },
  },
  {
    code: "FIRST_PROFIT",
    name: "First Profit",
    description: "Closed your first profitable trade.",
    category: "TRADING",
    criteria: { profitableTrades: 1 },
  },
  {
    code: "TEN_SUCCESSFUL_TRADES",
    name: "Ten Profitable Trades",
    description: "Closed ten profitable trades.",
    category: "TRADING",
    criteria: { profitableTrades: 10 },
  },
  {
    code: "PORTFOLIO_MILESTONE",
    name: "Portfolio Milestone",
    description: "Doubled your portfolio starting balance.",
    category: "PORTFOLIO",
    criteria: { multiplier: 2 },
  },
];

async function ensureCatalog() {
  for (const item of CATALOG) {
    await prisma.achievement.upsert({
      where: { code: item.code },
      create: item,
      update: {
        name: item.name,
        description: item.description,
        category: item.category,
        criteria: item.criteria,
      },
    });
  }
}

async function listAchievements() {
  await ensureCatalog();

  return prisma.achievement.findMany({
    orderBy: { createdAt: "asc" },
  });
}

async function listUserAchievements(userId) {
  await ensureCatalog();

  return prisma.userAchievement.findMany({
    where: { userId },
    include: {
      achievement: true,
    },
    orderBy: { unlockedAt: "desc" },
  });
}

async function grantAchievement(userId, achievementCode) {
  await ensureCatalog();

  const achievement = await prisma.achievement.findUnique({
    where: { code: achievementCode },
  });

  if (!achievement) {
    logger.warn(`Achievement ${achievementCode} not found in catalog.`);
    return null;
  }

  let userAchievement;
  let newlyGranted = false;

  try {
    userAchievement = await prisma.userAchievement.create({
      data: {
        userId,
        achievementId: achievement.id,
      },
      include: {
        achievement: true,
      },
    });
    newlyGranted = true;
  } catch (error) {
    if (error?.code === "P2002") {
      // Idempotent: already unlocked
      return null;
    }
    throw error;
  }

  if (newlyGranted) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: "ACHIEVEMENT_UNLOCKED",
          title: "Achievement unlocked",
          message: `You earned the "${achievement.name}" achievement!`,
          data: {
            achievementId: achievement.id,
            code: achievement.code,
            name: achievement.name,
            description: achievement.description,
          },
        },
      });

      void enqueueNotificationDelivery({ notificationId: notification.id }).catch(
        (error) => {
          logger.warn("Notification delivery enqueue failed", {
            notificationId: notification.id,
            message: error.message,
          });
        },
      );
    } catch (notificationError) {
      logger.warn("Failed to create achievement unlocked notification", {
        userId,
        achievementCode,
        error: notificationError.message,
      });
    }
  }

  return userAchievement;
}

async function evaluateAndGrantAchievements(userId, context = {}) {
  await ensureCatalog();

  const unlocked = await prisma.userAchievement.findMany({
    where: { userId },
    select: {
      achievement: {
        select: { code: true },
      },
    },
  });

  const unlockedCodes = new Set(unlocked.map((u) => u.achievement.code));
  const granted = [];

  // 1. FIRST_TRADE
  if (!unlockedCodes.has("FIRST_TRADE")) {
    const totalTrades = await prisma.trade.count({
      where: {
        portfolio: { userId },
      },
    });

    if (totalTrades >= 1) {
      const grant = await grantAchievement(userId, "FIRST_TRADE");
      if (grant) granted.push(grant);
      unlockedCodes.add("FIRST_TRADE");
    }
  }

  // 2. FIRST_PROFIT & TEN_SUCCESSFUL_TRADES
  if (
    !unlockedCodes.has("FIRST_PROFIT") ||
    !unlockedCodes.has("TEN_SUCCESSFUL_TRADES")
  ) {
    const profitableTrades = await prisma.trade.count({
      where: {
        portfolio: { userId },
        realizedPnl: { gt: 0 },
      },
    });

    if (!unlockedCodes.has("FIRST_PROFIT") && profitableTrades >= 1) {
      const grant = await grantAchievement(userId, "FIRST_PROFIT");
      if (grant) granted.push(grant);
      unlockedCodes.add("FIRST_PROFIT");
    }

    if (!unlockedCodes.has("TEN_SUCCESSFUL_TRADES") && profitableTrades >= 10) {
      const grant = await grantAchievement(userId, "TEN_SUCCESSFUL_TRADES");
      if (grant) granted.push(grant);
      unlockedCodes.add("TEN_SUCCESSFUL_TRADES");
    }
  }

  // 3. PORTFOLIO_MILESTONE (evaluated per portfolio: totalValue >= startingBalance * 2)
  // Calculates valuation at real-time market prices; does not award or fall back to cost basis when prices are unavailable.
  if (!unlockedCodes.has("PORTFOLIO_MILESTONE")) {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        startingBalance: true,
      },
    });

    for (const portfolio of portfolios) {
      if (portfolio.startingBalance && new Prisma.Decimal(portfolio.startingBalance).gt(0)) {
        try {
          const valuation = await calculatePortfolioValuation(portfolio.id, {
            priceProvider: context.priceProvider,
          });

          const startingBalance = new Prisma.Decimal(portfolio.startingBalance);
          const targetBalance = startingBalance.mul(2);

          if (valuation.totalValue.gte(targetBalance)) {
            const grant = await grantAchievement(userId, "PORTFOLIO_MILESTONE");
            if (grant) granted.push(grant);
            unlockedCodes.add("PORTFOLIO_MILESTONE");
            break;
          }
        } catch (error) {
          // If market data is unavailable or valuation fails, do NOT fall back to cost basis.
          // Log a warning and skip evaluating this portfolio for now.
          logger.warn("Portfolio valuation unavailable during milestone evaluation", {
            userId,
            portfolioId: portfolio.id,
            error: error.message,
          });
        }
      }
    }
  }

  return granted;
}

/**
 * Durable crash-recovery reconciliation job.
 * Scans active users and reconciles ungranted achievements.
 */
async function reconcileAchievements() {
  await ensureCatalog();

  const users = await prisma.user.findMany({
    where: { isSuspended: false },
    select: { id: true },
  });

  let totalReconciled = 0;

  for (const user of users) {
    try {
      const granted = await evaluateAndGrantAchievements(user.id);
      totalReconciled += granted.length;
    } catch (error) {
      logger.error("Failed to reconcile achievements for user", {
        userId: user.id,
        error: error.message,
      });
    }
  }

  return { usersChecked: users.length, newlyGranted: totalReconciled };
}

module.exports = {
  CATALOG,
  ensureCatalog,
  listAchievements,
  listUserAchievements,
  grantAchievement,
  evaluateAndGrantAchievements,
  reconcileAchievements,
};

