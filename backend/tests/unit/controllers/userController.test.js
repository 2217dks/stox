const userController = require("../../../src/controllers/userController");
const authService = require("../../../src/services/authService");
const userStatisticsService = require("../../../src/services/userStatisticsService");
const cacheService = require("../../../src/services/cacheService");
const prisma = require("../../../src/config/database");

jest.mock("../../../src/services/authService");
jest.mock("../../../src/services/userStatisticsService");
jest.mock("../../../src/services/socialService");
jest.mock("../../../src/config/database", () => ({
  portfolio: {
    findFirst: jest.fn(),
  },
}));
jest.mock("../../../src/services/cacheService", () => ({
  getOrSetUserStatistics: jest.fn((uid, filters, loader) => loader()),
  getOrSetUserMonthlyStatistics: jest.fn((uid, filters, loader) => loader()),
}));

describe("userController - Statistics endpoints", () => {
  const userId = "user-123";
  const portfolioId = "port-123";

  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { userId },
      validatedQuery: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    next = jest.fn();
  });

  describe("getMyStatistics", () => {
    test("verifies current user existence before cache lookup", async () => {
      authService.getCurrentUser.mockResolvedValue({ id: userId, isSuspended: false });
      userStatisticsService.getUserStatistics.mockResolvedValue({
        totalTrades: 5,
        winningTrades: 3,
        losingTrades: 2,
      });

      await userController.getMyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(cacheService.getOrSetUserStatistics).toHaveBeenCalledWith(
        userId,
        {},
        expect.any(Function),
      );
      expect(userStatisticsService.getUserStatistics).toHaveBeenCalledWith(
        userId,
        {},
        { prevalidated: true },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          statistics: { totalTrades: 5, winningTrades: 3, losingTrades: 2 },
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next and skips cache when account is suspended", async () => {
      const error = new Error("Account is suspended.");
      error.statusCode = 403;
      error.code = "ACCOUNT_SUSPENDED";
      authService.getCurrentUser.mockRejectedValue(error);

      await userController.getMyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(cacheService.getOrSetUserStatistics).not.toHaveBeenCalled();
      expect(userStatisticsService.getUserStatistics).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    test("passes error to next and skips cache when user does not exist", async () => {
      const error = new Error("User not found.");
      error.statusCode = 404;
      error.code = "USER_NOT_FOUND";
      authService.getCurrentUser.mockRejectedValue(error);

      await userController.getMyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(cacheService.getOrSetUserStatistics).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    test("verifies portfolio ownership before cache lookup if portfolioId is supplied", async () => {
      req.validatedQuery = { portfolioId };
      authService.getCurrentUser.mockResolvedValue({ id: userId });
      prisma.portfolio.findFirst.mockResolvedValue(null);

      await userController.getMyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
        where: { id: portfolioId, userId },
        select: { id: true },
      });
      expect(cacheService.getOrSetUserStatistics).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: "PORTFOLIO_NOT_FOUND",
        }),
      );
    });
  });

  describe("getMyMonthlyStatistics", () => {
    test("verifies current user existence before cache lookup", async () => {
      authService.getCurrentUser.mockResolvedValue({ id: userId, isSuspended: false });
      userStatisticsService.getMonthlyTradeStatistics.mockResolvedValue([
        { month: "2026-01", totalTrades: 2 },
      ]);

      await userController.getMyMonthlyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(cacheService.getOrSetUserMonthlyStatistics).toHaveBeenCalledWith(
        userId,
        {},
        expect.any(Function),
      );
      expect(userStatisticsService.getMonthlyTradeStatistics).toHaveBeenCalledWith(
        userId,
        {},
        { prevalidated: true },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          monthly: [{ month: "2026-01", totalTrades: 2 }],
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when user is suspended", async () => {
      const error = new Error("Account is suspended.");
      error.statusCode = 403;
      error.code = "ACCOUNT_SUSPENDED";
      authService.getCurrentUser.mockRejectedValue(error);

      await userController.getMyMonthlyStatistics(req, res, next);

      expect(authService.getCurrentUser).toHaveBeenCalledWith(userId);
      expect(cacheService.getOrSetUserMonthlyStatistics).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
