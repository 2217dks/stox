import { apiFetch } from "./api";

const call = (path, options) => apiFetch(path, options);

export const authApi = {
  register: (body) => call("/auth/register", { method: "POST", body }),
  login: (body) => call("/auth/login", { method: "POST", body }),
  google: (credential) =>
    call("/auth/google", { method: "POST", body: { credential } }),
  refresh: (refreshToken) =>
    call("/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: (refreshToken) =>
    call("/auth/logout", { method: "POST", body: { refreshToken } }),
  me: () => call("/auth/me"),
  updateProfile: (body) => call("/auth/profile", { method: "PATCH", body }),
};

export const usersApi = {
  statistics: (query) => call("/users/me/statistics", { query }),
  monthlyStatistics: (query) =>
    call("/users/me/statistics/monthly", { query }),
  publicProfile: (id) => call(`/users/${id}`),
};

export const portfoliosApi = {
  list: () => call("/portfolios"),
  create: (body) => call("/portfolios", { method: "POST", body }),
  get: (portfolioId) => call(`/portfolios/${portfolioId}`),
  update: (portfolioId, body) =>
    call(`/portfolios/${portfolioId}`, { method: "PATCH", body }),
  remove: (portfolioId) =>
    call(`/portfolios/${portfolioId}`, { method: "DELETE" }),
  reactivate: (portfolioId) =>
    call(`/portfolios/${portfolioId}/reactivate`, { method: "POST" }),
  holdings: (portfolioId) => call(`/portfolios/${portfolioId}/holdings`),
  cashBalance: (portfolioId) =>
    call(`/portfolios/${portfolioId}/cash-balance`),
  summary: (portfolioId) => call(`/portfolios/${portfolioId}/summary`),
  pnlHeatmap: (portfolioId, query) =>
    call(`/portfolios/${portfolioId}/pnl-heatmap`, { query }),
  riskMetrics: (portfolioId, query) =>
    call(`/portfolios/${portfolioId}/risk-metrics`, { query }),
  benchmark: (portfolioId, query) =>
    call(`/portfolios/${portfolioId}/benchmark`, { query }),
  benchmarkComparison: (portfolioId, query) =>
    call(`/portfolios/${portfolioId}/benchmark-comparison`, { query }),
  monthlyPerformance: (portfolioId, query) =>
    call(`/portfolios/${portfolioId}/monthly-performance`, { query }),
};

export const ordersApi = {
  list: (query) => call("/orders", { query }),
  create: (body) => call("/orders", { method: "POST", body }),
  get: (id) => call(`/orders/${id}`),
  events: (id) => call(`/orders/${id}/events`),
  cancel: (id) => call(`/orders/${id}`, { method: "DELETE" }),
};

export const tradesApi = {
  list: (query) => call("/trades", { query }),
  get: (id) => call(`/trades/${id}`),
};

export const alertsApi = {
  list: (query) => call("/alerts", { query }),
  create: (body) => call("/alerts", { method: "POST", body }),
  update: (alertId, body) =>
    call(`/alerts/${alertId}`, { method: "PATCH", body }),
  remove: (alertId) => call(`/alerts/${alertId}`, { method: "DELETE" }),
};

export const notificationsApi = {
  list: (query) => call("/notifications", { query }),
  markRead: (notificationId) =>
    call(`/notifications/${notificationId}/read`, { method: "PATCH" }),
  markAllRead: () => call("/notifications/read-all", { method: "PATCH" }),
};

export const socialApi = {
  feed: (query) => call("/social/feed", { query }),
  createPost: (body) => call("/social/posts", { method: "POST", body }),
  getPost: (postId) => call(`/social/posts/${postId}`),
  deletePost: (postId) =>
    call(`/social/posts/${postId}`, { method: "DELETE" }),
  engagement: (postId) => call(`/social/posts/${postId}/engagement`),
  like: (postId) => call(`/social/posts/${postId}/likes`, { method: "POST" }),
  unlike: (postId) =>
    call(`/social/posts/${postId}/likes`, { method: "DELETE" }),
  followers: () => call("/social/followers"),
  following: () => call("/social/following"),
  follow: (userId) => call(`/social/follow/${userId}`, { method: "POST" }),
  unfollow: (userId) =>
    call(`/social/follow/${userId}`, { method: "DELETE" }),
};

export const leaderboardApi = {
  global: (query) => call("/leaderboard", { query }),
  friends: (query) => call("/leaderboard/friends", { query }),
  history: (query) => call("/leaderboard/history", { query }),
};

export const copyTradingApi = {
  list: (query) => call("/copy-trading", { query }),
  create: (body) => call("/copy-trading", { method: "POST", body }),
  update: (id, body) =>
    call(`/copy-trading/${id}`, { method: "PATCH", body }),
  remove: (id) => call(`/copy-trading/${id}`, { method: "DELETE" }),
};

export const marketApi = {
  search: (query) => call("/market/search", { query }),
  cryptoQuote: (symbol) =>
    call(`/market/quote/${encodeURIComponent(symbol)}`),
  stockQuote: (symbol) =>
    call(`/market/quote/stock/${encodeURIComponent(symbol)}`),
  quote: (symbol, assetClass) =>
    assetClass === "CRYPTO"
      ? marketApi.cryptoQuote(symbol)
      : marketApi.stockQuote(symbol),
  quotes: (symbols, assetTypes = {}) => {
    const query = { symbols: symbols.join(",") };
    if (
      assetTypes &&
      typeof assetTypes === "object" &&
      Object.keys(assetTypes).length > 0
    ) {
      query.assetTypes = Object.entries(assetTypes)
        .filter(([_, v]) => Boolean(v))
        .map(([k, v]) => `${k}:${v}`)
        .join(",");
    }
    return call("/market/quotes", { query });
  },
  history: (symbol, query) =>
    call(`/market/history/${encodeURIComponent(symbol)}`, { query }),
  overview: (query) => call("/market/overview", { query }),
};

export const sentimentApi = {
  get: (symbol, query) =>
    call(`/sentiment/${encodeURIComponent(symbol)}`, { query }),
  vote: (symbol, sentiment) =>
    call(`/sentiment/${encodeURIComponent(symbol)}/vote`, {
      method: "POST",
      body: { sentiment },
    }),
};

export const achievementsApi = {
  list: (query) => call("/achievements", { query }),
  mine: () => call("/achievements/mine"),
};

export const leaguesApi = {
  list: (query) => call("/leagues", { query }),
  get: (id) => call(`/leagues/${id}`),
  create: (body) => call("/leagues", { method: "POST", body }),
  join: (id, body = {}) => call(`/leagues/${id}/join`, { method: "POST", body }),
  leaderboard: (id, query) => call(`/leagues/${id}/leaderboard`, { query }),
};

export const adminApi = {
  orders: (query) => call("/admin/orders", { query }),
  portfolios: (query) => call("/admin/portfolios", { query }),
  portfolio: (portfolioId) => call(`/admin/portfolios/${portfolioId}`),
  users: (query) => call("/admin/users", { query }),
  user: (userId) => call(`/admin/users/${userId}`),
};

export const preferencesApi = {
  get: () => call("/preferences"),
  update: (body) => call("/preferences", { method: "PATCH", body }),
};

export const healthApi = {
  check: () => call("/health"),
};
