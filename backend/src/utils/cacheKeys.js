const PREFIX = "stox:v1";

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }

  return String(value);
}

function normalizeSymbol(symbol) {
  return required(symbol, "symbol").trim().toUpperCase();
}

function normalizeDateBound(date) {
  if (!date) return "";
  if (date instanceof Date) return date.toISOString();
  return String(date).trim();
}

function normalizeNumber(num, fallback) {
  if (num === undefined || num === null || num === "") return String(fallback);
  const n = Number(num);
  return Number.isFinite(n) ? String(n) : String(fallback);
}

function normalizeString(str) {
  if (str === undefined || str === null) return "";
  return String(str).trim();
}

function formatGen(gen) {
  const s = normalizeString(gen);
  return s ? `g:${s}:` : "";
}

const cacheKeys = {
  price(assetClass, symbol) {
    return `${PREFIX}:price:${required(assetClass, "assetClass")}:${normalizeSymbol(symbol)}`;
  },

  portfolioSummary(portfolioId) {
    return `${PREFIX}:portfolio:summary:${required(portfolioId, "portfolioId")}`;
  },

  portfolioSummaryGeneration(portfolioId) {
    return `${PREFIX}:portfolio:summary:generation:${required(
      portfolioId,
      "portfolioId",
    )}`;
  },

  leaderboard(scope, period, page, limit, userId = null) {
    const owner = scope === "friends" ? `:${required(userId, "userId")}` : "";

    return `${PREFIX}:leaderboard:${scope}${owner}:${period}:${page}:${limit}`;
  },

  historicalPrices(assetClass, symbol, interval, from, to, limit) {
    return [
      PREFIX,
      "market",
      "history",
      required(assetClass, "assetClass"),
      normalizeSymbol(symbol),
      required(interval, "interval"),
      required(from, "from"),
      required(to, "to"),
      required(limit, "limit"),
    ].join(":");
  },

  symbol(assetClass, symbol) {
    return `${PREFIX}:symbol:${required(assetClass, "assetClass")}:${normalizeSymbol(symbol)}`;
  },

  marketSearch(query, options = {}) {
    const raw = required(query, "query").trim().replace(/\s+/g, " ");
    if (!raw) {
      throw new Error("query is required");
    }
    const q = raw.toUpperCase();
    const assetClass = options.assetClass
      ? String(options.assetClass).trim().toUpperCase()
      : "ALL";
    const limit =
      options.limit !== undefined &&
      options.limit !== null &&
      options.limit !== ""
        ? normalizeNumber(options.limit, "ALL")
        : "ALL";

    return `${PREFIX}:market:search:${assetClass}:${q}:${limit}`;
  },

  symbolSearch(query, options = {}) {
    return cacheKeys.marketSearch(query, options);
  },

  session(userId) {
    return `${PREFIX}:session:${required(userId, "userId")}`;
  },

  metric(name) {
    return `${PREFIX}:metrics:cache:${required(name, "name")}`;
  },

  portfolioAnalyticsGeneration(portfolioId) {
    return `${PREFIX}:analytics:generation:portfolio:${required(
      portfolioId,
      "portfolioId",
    )}`;
  },

  userAnalyticsGeneration(userId) {
    return `${PREFIX}:analytics:generation:user:${required(
      userId,
      "userId",
    )}`;
  },

  analyticsPortfolioHeatmap(portfolioId, userId, options = {}) {
    const period = normalizeString(options.period || "1M").toUpperCase();
    const year = normalizeString(options.year);
    const genPart = formatGen(options.generation);
    return `${PREFIX}:analytics:p:${required(portfolioId, "portfolioId")}:u:${required(userId, "userId")}:${genPart}heatmap:${period}:${year}`;
  },

  analyticsPortfolioRiskMetrics(portfolioId, userId, options = {}) {
    const period = normalizeString(options.period || "1M").toUpperCase();
    const riskFreeRate = normalizeNumber(options.riskFreeRate, 0.02);
    const genPart = formatGen(options.generation);
    return `${PREFIX}:analytics:p:${required(portfolioId, "portfolioId")}:u:${required(userId, "userId")}:${genPart}risk-metrics:${period}:${riskFreeRate}`;
  },

  analyticsPortfolioBenchmark(portfolioId, userId, symbol = "SPY", options = {}) {
    const sym = normalizeSymbol(symbol || "SPY");
    const period = normalizeString(options.period || "1M").toUpperCase();
    const genPart = formatGen(options.generation);
    return `${PREFIX}:analytics:p:${required(portfolioId, "portfolioId")}:u:${required(userId, "userId")}:${genPart}benchmark:${sym}:${period}`;
  },

  analyticsPortfolioBenchmarkComparison(portfolioId, userId, symbol = "SPY", options = {}) {
    const sym = normalizeSymbol(symbol || "SPY");
    const period = normalizeString(options.period || "1M").toUpperCase();
    const riskFreeRate = normalizeNumber(options.riskFreeRate, 0.02);
    const genPart = formatGen(options.generation);
    return `${PREFIX}:analytics:p:${required(portfolioId, "portfolioId")}:u:${required(userId, "userId")}:${genPart}benchmark-comparison:${sym}:${period}:${riskFreeRate}`;
  },

  analyticsPortfolioMonthlyPerformance(portfolioId, userId, options = {}) {
    const year = normalizeString(options.year);
    const from = normalizeDateBound(options.from);
    const to = normalizeDateBound(options.to);
    const genPart = formatGen(options.generation);
    return `${PREFIX}:analytics:p:${required(portfolioId, "portfolioId")}:u:${required(userId, "userId")}:${genPart}monthly:${year}:${from}:${to}`;
  },

  analyticsUserStatistics(userId, filters = {}) {
    const portfolioId = normalizeString(filters.portfolioId);
    const sym = filters.symbol ? normalizeSymbol(filters.symbol) : "";
    const side = normalizeString(filters.side).toUpperCase();
    const assetType = normalizeString(filters.assetType).toUpperCase();
    const from = normalizeDateBound(filters.from);
    const to = normalizeDateBound(filters.to);
    const includeMonthly = filters.includeMonthly ? "1" : "0";
    const genPart = formatGen(filters.generation);
    return `${PREFIX}:analytics:u:${required(userId, "userId")}:${genPart}stats:${portfolioId}:${sym}:${side}:${assetType}:${from}:${to}:${includeMonthly}`;
  },

  analyticsUserMonthlyStatistics(userId, filters = {}) {
    const portfolioId = normalizeString(filters.portfolioId);
    const sym = filters.symbol ? normalizeSymbol(filters.symbol) : "";
    const side = normalizeString(filters.side).toUpperCase();
    const assetType = normalizeString(filters.assetType).toUpperCase();
    const from = normalizeDateBound(filters.from);
    const to = normalizeDateBound(filters.to);
    const genPart = formatGen(filters.generation);
    return `${PREFIX}:analytics:u:${required(userId, "userId")}:${genPart}stats-monthly:${portfolioId}:${sym}:${side}:${assetType}:${from}:${to}`;
  },
};

module.exports = cacheKeys;
