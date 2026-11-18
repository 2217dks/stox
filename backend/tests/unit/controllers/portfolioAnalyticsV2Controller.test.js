jest.mock("../../../src/services/portfolioPerformanceService", () => ({
  getPortfolioPerformance: jest.fn(),
}));
jest.mock("../../../src/services/portfolioHistoryService", () => ({
  getPortfolioHistoricalState: jest.fn(),
}));
jest.mock("../../../src/services/portfolioAllocationService", () => ({
  getPortfolioAllocation: jest.fn(),
}));

const portfolioController = require("../../../src/controllers/portfolioController");
const { getPortfolioPerformance } = require("../../../src/services/portfolioPerformanceService");
const { getPortfolioHistoricalState } = require("../../../src/services/portfolioHistoryService");
const { getPortfolioAllocation } = require("../../../src/services/portfolioAllocationService");
const { AppError } = require("../../../src/utils/errors");

describe("portfolioController - Performance, History, and Allocation endpoints", () => {
  const userId = "usr-test-123";
  const portfolioId = "port-test-456";

  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { userId },
      validatedParams: { portfolioId },
      validatedQuery: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getPortfolioPerformance", () => {
    test("returns performance data with 200 on success", async () => {
      const mockResult = {
        portfolioId,
        period: "1M",
        performance: { netPnl: "200.00000000", returnPct: "2.0000" },
      };
      getPortfolioPerformance.mockResolvedValue(mockResult);

      req.validatedQuery = { period: "1M" };

      await portfolioController.getPortfolioPerformance(req, res, next);

      expect(getPortfolioPerformance).toHaveBeenCalledWith(userId, portfolioId, { period: "1M" });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next on failure", async () => {
      const error = AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
      getPortfolioPerformance.mockRejectedValue(error);

      await portfolioController.getPortfolioPerformance(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("getPortfolioHistory", () => {
    test("returns historical state data with 200 on success", async () => {
      const mockResult = {
        portfolioId,
        metadata: { totalDays: 30, recordedDays: 28, missingDays: 2, hasGaps: true },
        history: [],
      };
      getPortfolioHistoricalState.mockResolvedValue(mockResult);

      req.validatedQuery = { from: "2026-10-01", to: "2026-10-31" };

      await portfolioController.getPortfolioHistory(req, res, next);

      expect(getPortfolioHistoricalState).toHaveBeenCalledWith(userId, portfolioId, {
        from: "2026-10-01",
        to: "2026-10-31",
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    test("passes error to next on failure", async () => {
      const error = AppError.badRequest("Date range too large", "DATE_RANGE_TOO_LARGE");
      getPortfolioHistoricalState.mockRejectedValue(error);

      await portfolioController.getPortfolioHistory(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("getPortfolioAllocation", () => {
    test("returns allocation data with 200 on success", async () => {
      const mockResult = {
        portfolioId,
        dimension: "symbol",
        totalPortfolioValue: "10000.00000000",
        allocations: [],
        reconciliation: { totalPercentage: "100.0000", isReconciled: true },
      };
      getPortfolioAllocation.mockResolvedValue(mockResult);

      req.validatedQuery = { dimension: "symbol" };

      await portfolioController.getPortfolioAllocation(req, res, next);

      expect(getPortfolioAllocation).toHaveBeenCalledWith(userId, portfolioId, { dimension: "symbol" });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    test("passes error to next on failure", async () => {
      const error = AppError.badRequest("Invalid dimension", "INVALID_ALLOCATION_DIMENSION");
      getPortfolioAllocation.mockRejectedValue(error);

      await portfolioController.getPortfolioAllocation(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
