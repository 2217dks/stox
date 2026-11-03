const { AppError } = require("../utils/errors");

function createMarketDataError(message, statusCode, code) {
  return new AppError(message, { statusCode, code });
}

function mapProviderError(error) {
  if (
    error?.isOperational &&
    typeof error.code === "string" &&
    error.code.startsWith("MARKET_DATA_")
  ) {
    return error;
  }

  const status = error?.response?.status;
  const providerCode = error?.response?.data?.code;
  const providerMessage =
    error?.response?.data?.error || error?.response?.data?.msg;

  if (
    status === 403 &&
    /rate.?limit|too many requests|banned/i.test(String(providerMessage || ""))
  ) {
    return createMarketDataError(
      "Market data provider rate limit reached.",
      429,
      "MARKET_DATA_RATE_LIMITED",
    );
  }

  if (status === 429 || status === 418) {
    return createMarketDataError(
      "Market data provider rate limit reached.",
      429,
      "MARKET_DATA_RATE_LIMITED",
    );
  }

  if (status === 401 || status === 403) {
    return createMarketDataError(
      "Market data provider credentials are invalid or unavailable.",
      503,
      "MARKET_DATA_INVALID_CREDENTIALS",
    );
  }

  if (
    status === 404 ||
    providerCode === -1121 ||
    /no data|not found|invalid symbol/i.test(String(providerMessage || ""))
  ) {
    return createMarketDataError(
      "Market data is unavailable for the requested symbol or range.",
      404,
      "MARKET_DATA_NOT_FOUND",
    );
  }

  if (
    error?.code === "ECONNABORTED" ||
    error?.code === "ETIMEDOUT" ||
    /timeout/i.test(String(error?.message || ""))
  ) {
    return createMarketDataError(
      "Market data provider request timed out.",
      504,
      "MARKET_DATA_TIMEOUT",
    );
  }

  return createMarketDataError(
    "Market data provider is temporarily unavailable.",
    503,
    "MARKET_DATA_PROVIDER_UNAVAILABLE",
  );
}

module.exports = {
  createMarketDataError,
  mapProviderError,
};
