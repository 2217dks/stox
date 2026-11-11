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

  session(userId) {
    return `${PREFIX}:session:${required(userId, "userId")}`;
  },

  metric(name) {
    return `${PREFIX}:metrics:cache:${required(name, "name")}`;
  },
};

module.exports = cacheKeys;
