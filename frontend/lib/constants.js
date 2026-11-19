export const APP_NAME = "Stox";
export const APP_TAGLINE = "Paper trading, real markets.";

/**
 * Quote-asset hints used only for display (ticker and pair labels).
 *
 * Requests are never gated by this list: Binance is the authority for which
 * pairs exist. Longer ids must come first so suffix matching stays
 * unambiguous. The one-letter `U` quote asset is intentionally omitted
 * because it would mislabel short stock tickers.
 */
export const CRYPTO_QUOTE_ASSETS = [
  "FDUSD",
  "RLUSD",
  "USDT",
  "USDC",
  "TUSD",
  "BUSD",
  "USDS",
  "USD1",
  "EURI",
  "USDP",
  "BTC",
  "ETH",
  "BNB",
  "XRP",
  "TRY",
  "EUR",
  "ZAR",
  "BRL",
  "ARS",
  "JPY",
  "MXN",
  "COP",
  "IDR",
  "KZT",
  "AED",
  "THB",
  "USD",
];

export const ORDER_SIDES = [
  { value: "BUY", label: "Buy", tone: "up" },
  { value: "SELL", label: "Sell", tone: "down" },
];

export const ORDER_TYPES = [
  { value: "MARKET", label: "Market", hint: "Fill at the best available price" },
  { value: "LIMIT", label: "Limit", hint: "Fill at your price or better" },
  {
    value: "STOP_LOSS",
    label: "Stop loss",
    hint: "Trigger a market order at a stop price",
  },
  {
    value: "TAKE_PROFIT",
    label: "Take profit",
    hint: "Trigger a market order at a target price",
  },
];

export const ORDER_STATUS = {
  PENDING: { label: "Pending", tone: "warn" },
  EXECUTED: { label: "Executed", tone: "up" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REJECTED: { label: "Rejected", tone: "down" },
};

export const ORDER_EVENT_TYPES = {
  CREATED: { label: "Created", tone: "info" },
  EXECUTED: { label: "Executed", tone: "up" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REJECTED: { label: "Rejected", tone: "down" },
};

export const ALERT_STATUS = {
  ACTIVE: { label: "Active", tone: "brand" },
  TRIGGERED: { label: "Triggered", tone: "warn" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const ALERT_CONDITIONS = [
  { value: "PRICE_ABOVE", label: "Price above", short: "Above", unit: "price" },
  { value: "PRICE_BELOW", label: "Price below", short: "Below", unit: "price" },
  {
    value: "PERCENT_CHANGE_UP",
    label: "Rises by",
    short: "Up %",
    unit: "percent",
  },
  {
    value: "PERCENT_CHANGE_DOWN",
    label: "Falls by",
    short: "Down %",
    unit: "percent",
  },
];

export const ASSET_TYPES = [
  { value: "STOCK", label: "Stocks" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "FOREX", label: "Forex" },
];

export const ASSET_CLASS_OPTIONS = [
  { value: "STOCK", label: "Stocks" },
  { value: "CRYPTO", label: "Crypto" },
];

export const TRADE_SIDES = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
];

export const LEADERBOARD_PERIODS = [
  { value: "DAILY", label: "1D" },
  { value: "WEEKLY", label: "1W" },
  { value: "MONTHLY", label: "1M" },
  { value: "ALL_TIME", label: "All" },
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * One control, one meaning: each entry is the visible window. The candle
 * resolution is an implementation detail chosen to keep the window readable
 * and within the backend's 1,000-candle limit.
 */
export const CHART_TIMEFRAMES = [
  { value: "1D", label: "1D", interval: "5m", milliseconds: DAY_MS, candles: 288 },
  { value: "1W", label: "1W", interval: "1h", milliseconds: 7 * DAY_MS, candles: 168 },
  { value: "1M", label: "1M", interval: "4h", milliseconds: 30 * DAY_MS, candles: 180 },
  { value: "3M", label: "3M", interval: "4h", milliseconds: 90 * DAY_MS, candles: 540 },
  { value: "1Y", label: "1Y", interval: "1d", milliseconds: 365 * DAY_MS, candles: 365 },
  { value: "3Y", label: "3Y", interval: "1w", milliseconds: 3 * 365 * DAY_MS, candles: 157 },
];

export const MAX_CHART_CANDLES = 1000;

export function chartRequestWindow(timeframeValue, now = Date.now()) {
  const timeframe = CHART_TIMEFRAMES.find((item) => item.value === timeframeValue);
  const selected = timeframe ?? CHART_TIMEFRAMES[0];
  return {
    from: now - selected.milliseconds,
    to: now,
    limit: Math.min(MAX_CHART_CANDLES, selected.candles),
  };
}

export const CURATED_SYMBOLS = {
  STOCK: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD"],
  CRYPTO: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"],
};

export const QUICK_ALLOCATIONS = [25, 50, 75, 100];

export const CURATED_MARKET_META = {
  AAPL: { name: "Apple Inc.", assetType: "STOCK", exchange: "NASDAQ" },
  MSFT: { name: "Microsoft Corp.", assetType: "STOCK", exchange: "NASDAQ" },
  NVDA: { name: "NVIDIA Corp.", assetType: "STOCK", exchange: "NASDAQ" },
  TSLA: { name: "Tesla, Inc.", assetType: "STOCK", exchange: "NASDAQ" },
  AMZN: { name: "Amazon.com, Inc.", assetType: "STOCK", exchange: "NASDAQ" },
  META: { name: "Meta Platforms", assetType: "STOCK", exchange: "NASDAQ" },
  GOOGL: { name: "Alphabet Inc.", assetType: "STOCK", exchange: "NASDAQ" },
  AMD: { name: "Advanced Micro Devices", assetType: "STOCK", exchange: "NASDAQ" },
  BTCUSDT: { name: "Bitcoin / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
  ETHUSDT: { name: "Ethereum / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
  SOLUSDT: { name: "Solana / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
  BNBUSDT: { name: "BNB / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
  XRPUSDT: { name: "XRP / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
  DOGEUSDT: { name: "Dogecoin / TetherUS", assetType: "CRYPTO", exchange: "Binance" },
};

export const MARKET_STATUS_LABELS = {
  OPEN: "Market open",
  CLOSED: "Market closed",
  PRE_MARKET: "Pre-market",
  AFTER_HOURS: "After hours",
  UNKNOWN: "Market status unknown",
};

export const NOTIFICATION_TYPES = {
  ORDER_EXECUTED: { label: "Order executed", tone: "up" },
  ORDER_CANCELLED: { label: "Order cancelled", tone: "neutral" },
  ORDER_REJECTED: { label: "Order rejected", tone: "down" },
  ORDER_EXPIRED: { label: "Order expired", tone: "neutral" },
  PRICE_ALERT: { label: "Price alert", tone: "brand" },
  ACHIEVEMENT_UNLOCKED: { label: "Achievement", tone: "violet" },
  COPY_TRADE_EXECUTED: { label: "Copy trade", tone: "info" },
  LEAGUE_UPDATE: { label: "League", tone: "warn" },
  NEW_FOLLOWER: { label: "New follower", tone: "cyan" },
  SYSTEM: { label: "System", tone: "neutral" },
};

export const LEAGUE_STATUS = {
  UPCOMING: { label: "Upcoming", tone: "info" },
  ACTIVE: { label: "Active", tone: "up" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "down" },
};

export const DETAIL_TABS = {
  portfolio: [
    { value: "overview", label: "Overview" },
    { value: "analytics", label: "Analytics" },
    { value: "activity", label: "Activity" },
  ],
};
