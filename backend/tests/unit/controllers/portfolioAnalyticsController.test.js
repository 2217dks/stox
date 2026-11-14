const portfolioController = require("../../../src/controllers/portfolioController");
const portfolioService = require("../../../src/services/portfolioService");
const portfolioHeatmapService = require("../../../src/services/portfolioHeatmapService");
const riskMetricsService = require("../../../src/services/riskMetricsService");
const benchmarkService = require("../../../src/services/benchmarkService");

jest.mock("../../../src/services/portfolioService");
jest.mock("../../../src/services/portfolioHeatmapService");
jest.mock("../../../src/services/riskMetricsService");
jest.mock("../../../src/services/benchmarkService");

describe("portfolioController - Analytics endpoints", () => {
  const userId = "user-123";
  const portfolioId = "11111111-1111-4111-8111-111111111111";

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

  describe("getPnlHeatmap", () => {
    test("verifies ownership and returns heatmap data", async () => {
      req.validatedQuery = { period: "1M", year: undefined };
      portfolioService.getPortfolioById.mockResolvedValue({ id: portfolioId, userId });
      portfolioHeatmapService.getPortfolioPnlHeatmap.mockResolvedValue({
        portfolioId,
        period: "1M",
        heatmap: [],
        summary: { totalPnl: "0.00000000", winDays: 0, lossDays: 0, flatDays: 0 },
      });

      await portfolioController.getPnlHeatmap(req, res, next);

      expect(portfolioService.getPortfolioById).toHaveBeenCalledWith(userId, portfolioId);
      expect(portfolioHeatmapService.getPortfolioPnlHeatmap).toHaveBeenCalledWith(
        portfolioId,
        { period: "1M", year: undefined },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ portfolioId, period: "1M" }),
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when ownership fails", async () => {
      const error = new Error("Portfolio not found.");
      portfolioService.getPortfolioById.mockRejectedValue(error);

      await portfolioController.getPnlHeatmap(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(portfolioHeatmapService.getPortfolioPnlHeatmap).not.toHaveBeenCalled();
    });
  });

  describe("getRiskMetrics", () => {
    test("verifies ownership and returns risk metrics data", async () => {
      req.validatedQuery = { period: "1M", riskFreeRate: 0.02 };
      portfolioService.getPortfolioById.mockResolvedValue({ id: portfolioId, userId });
      riskMetricsService.getPortfolioRiskMetrics.mockResolvedValue({
        portfolioId,
        period: "1M",
        metrics: {
          annualizedVolatility: "0.1500",
          maxDrawdown: "-0.0500",
          currentDrawdown: "-0.0100",
          peakValue: "10500.00000000",
          peakDate: "2026-11-10",
          sharpeRatio: "1.25",
          observationCount: 15,
        },
      });

      await portfolioController.getRiskMetrics(req, res, next);

      expect(portfolioService.getPortfolioById).toHaveBeenCalledWith(userId, portfolioId);
      expect(riskMetricsService.getPortfolioRiskMetrics).toHaveBeenCalledWith(
        portfolioId,
        { period: "1M", riskFreeRate: 0.02 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ portfolioId, period: "1M" }),
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when risk metrics service fails", async () => {
      const error = new Error("Internal service failure");
      portfolioService.getPortfolioById.mockResolvedValue({ id: portfolioId, userId });
      riskMetricsService.getPortfolioRiskMetrics.mockRejectedValue(error);

      await portfolioController.getRiskMetrics(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("getBenchmark", () => {
    test("verifies ownership and returns benchmark data", async () => {
      req.validatedQuery = { symbol: "SPY", period: "1M" };
      portfolioService.getPortfolioById.mockResolvedValue({ id: portfolioId, userId });
      benchmarkService.getBenchmarkData.mockResolvedValue({
        benchmark: "SPY",
        period: "1M",
        prices: [{ date: "2026-11-01", price: "500.00", dailyReturn: "0.0100" }],
      });

      await portfolioController.getBenchmark(req, res, next);

      expect(portfolioService.getPortfolioById).toHaveBeenCalledWith(userId, portfolioId);
      expect(benchmarkService.getBenchmarkData).toHaveBeenCalledWith(
        "SPY",
        { period: "1M", portfolioId },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ benchmark: "SPY", period: "1M" }),
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when ownership check fails", async () => {
      const error = new Error("Portfolio not found.");
      portfolioService.getPortfolioById.mockRejectedValue(error);

      await portfolioController.getBenchmark(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(benchmarkService.getBenchmarkData).not.toHaveBeenCalled();
    });
  });
});
