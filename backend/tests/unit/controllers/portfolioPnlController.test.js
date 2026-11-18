jest.mock("../../../src/services/realizedPnlService", () => ({
  getPortfolioRealizedPnl: jest.fn(),
}));
jest.mock("../../../src/services/unrealizedPnlService", () => ({
  getPortfolioUnrealizedPnl: jest.fn(),
}));

const portfolioController = require("../../../src/controllers/portfolioController");
const realizedPnlService = require("../../../src/services/realizedPnlService");
const unrealizedPnlService = require("../../../src/services/unrealizedPnlService");
const { AppError } = require("../../../src/utils/errors");

describe("portfolioController - P&L endpoints", () => {
  const userId = "user-uuid-123";
  const portfolioId = "portfolio-uuid-456";

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

  describe("getRealizedPnl", () => {
    test("returns realized P&L data on success", async () => {
      const mockData = {
        portfolioId,
        period: "1M",
        realizedPnl: "100.00000000",
        realizedPnlPct: "10.0000",
        trades: [],
      };
      realizedPnlService.getPortfolioRealizedPnl.mockResolvedValue(mockData);

      req.validatedQuery = { period: "1M" };

      await portfolioController.getRealizedPnl(req, res, next);

      expect(realizedPnlService.getPortfolioRealizedPnl).toHaveBeenCalledWith(
        userId,
        portfolioId,
        expect.objectContaining({ period: "1M" }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockData,
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when service rejects", async () => {
      const error = AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
      realizedPnlService.getPortfolioRealizedPnl.mockRejectedValue(error);

      await portfolioController.getRealizedPnl(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("getUnrealizedPnl", () => {
    test("returns unrealized P&L data and positions on success", async () => {
      const mockData = {
        portfolioId,
        totalInvested: "2000.00000000",
        marketValue: "2200.00000000",
        unrealizedPnl: "200.00000000",
        unrealizedPnlPct: "10.0000",
        isStale: false,
        freshness: "FRESH",
        positions: [],
      };
      unrealizedPnlService.getPortfolioUnrealizedPnl.mockResolvedValue(mockData);

      req.validatedQuery = { rejectStale: false, allowStale: false };

      await portfolioController.getUnrealizedPnl(req, res, next);

      expect(unrealizedPnlService.getPortfolioUnrealizedPnl).toHaveBeenCalledWith(
        userId,
        portfolioId,
        expect.objectContaining({ rejectStale: false, allowStale: false }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockData,
      });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes error to next when service rejects (e.g. stale quote or not found)", async () => {
      const error = new AppError("Market data quote is stale.", {
        statusCode: 503,
        code: "MARKET_DATA_STALE_QUOTE",
      });
      unrealizedPnlService.getPortfolioUnrealizedPnl.mockRejectedValue(error);

      await portfolioController.getUnrealizedPnl(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
