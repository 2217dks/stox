const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const {
  portfolioIdParamsSchema,
  updatePortfolioSchema,
  pnlHeatmapQuerySchema,
  riskMetricsQuerySchema,
  benchmarkQuerySchema,
  benchmarkComparisonQuerySchema,
  monthlyPerformanceQuerySchema,
  realizedPnlQuerySchema,
  unrealizedPnlQuerySchema,
  portfolioSnapshotsQuerySchema,
  aggregatePnlQuerySchema,
  portfolioPerformanceQuerySchema,
  portfolioHistoryQuerySchema,
  portfolioAllocationQuerySchema,
} = require("../validators/portfolioValidator");
const portfolioController = require("../controllers/portfolioController");

const router = express.Router();

router.get("/", authMiddleware, portfolioController.listPortfolios);

router.post("/", authMiddleware, portfolioController.createPortfolio);

router.get(
  "/:portfolioId",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getPortfolio,
);

router.patch(
  "/:portfolioId",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(updatePortfolioSchema),
  portfolioController.updatePortfolio,
);

router.delete(
  "/:portfolioId",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.deletePortfolio,
);

router.post(
  "/:portfolioId/reactivate",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.reactivatePortfolio,
);

router.get(
  "/:portfolioId/holdings",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getPortfolioHoldings,
);

router.get(
  "/:portfolioId/cash-balance",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getCashBalance,
);

router.get(
  "/:portfolioId/summary",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getPortfolioSummary,
);

router.get(
  "/:portfolioId/pnl-heatmap",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(pnlHeatmapQuerySchema, "query", "validatedQuery"),
  portfolioController.getPnlHeatmap,
);

router.get(
  "/:portfolioId/risk-metrics",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(riskMetricsQuerySchema, "query", "validatedQuery"),
  portfolioController.getRiskMetrics,
);

router.get(
  "/:portfolioId/benchmark",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(benchmarkQuerySchema, "query", "validatedQuery"),
  portfolioController.getBenchmark,
);

router.get(
  "/:portfolioId/benchmark-comparison",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(benchmarkComparisonQuerySchema, "query", "validatedQuery"),
  portfolioController.getBenchmarkComparison,
);

router.get(
  "/:portfolioId/monthly-performance",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(monthlyPerformanceQuerySchema, "query", "validatedQuery"),
  portfolioController.getMonthlyPerformance,
);

router.get(
  "/:portfolioId/analytics/monthly-performance",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(monthlyPerformanceQuerySchema, "query", "validatedQuery"),
  portfolioController.getMonthlyPerformance,
);

router.get(
  "/:portfolioId/realized-pnl",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(realizedPnlQuerySchema, "query", "validatedQuery"),
  portfolioController.getRealizedPnl,
);

router.get(
  "/:portfolioId/unrealized-pnl",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(unrealizedPnlQuerySchema, "query", "validatedQuery"),
  portfolioController.getUnrealizedPnl,
);

router.get(
  "/:portfolioId/snapshots",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(portfolioSnapshotsQuerySchema, "query", "validatedQuery"),
  portfolioController.getPortfolioSnapshots,
);

router.get(
  "/:portfolioId/pnl",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(aggregatePnlQuerySchema, "query", "validatedQuery"),
  portfolioController.getAggregatePnl,
);

router.get(
  "/:portfolioId/dashboard",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  portfolioController.getDashboardSummary,
);

router.get(
  "/:portfolioId/performance",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(portfolioPerformanceQuerySchema, "query", "validatedQuery"),
  portfolioController.getPortfolioPerformance,
);

router.get(
  "/:portfolioId/history",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(portfolioHistoryQuerySchema, "query", "validatedQuery"),
  portfolioController.getPortfolioHistory,
);

router.get(
  "/:portfolioId/allocation",
  authMiddleware,
  validate(portfolioIdParamsSchema, "params", "validatedParams"),
  validate(portfolioAllocationQuerySchema, "query", "validatedQuery"),
  portfolioController.getPortfolioAllocation,
);

module.exports = router;
