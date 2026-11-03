const { AppError } = require("../utils/errors");

const DOMAIN_ERROR_DEFINITIONS = Object.freeze({
  MARKET_DATA_INVALID_REQUEST: {
    statusCode: 400,
    message: "The market data request is invalid.",
  },
  MARKET_DATA_NOT_FOUND: {
    statusCode: 404,
    message: "Market data is unavailable for the requested symbol or range.",
  },
  MARKET_DATA_UNSUPPORTED_ASSET_CLASS: {
    statusCode: 422,
    message: "Market data is not supported for this asset class.",
  },
  MARKET_DATA_NOT_CONFIGURED: {
    statusCode: 503,
    message: "The market data provider is not configured.",
  },
  MARKET_DATA_INVALID_CREDENTIALS: {
    statusCode: 503,
    message: "Market data provider credentials are invalid or unavailable.",
  },
  MARKET_DATA_RATE_LIMITED: {
    statusCode: 429,
    message: "Market data provider rate limit reached.",
  },
  MARKET_DATA_TIMEOUT: {
    statusCode: 504,
    message: "Market data provider request timed out.",
  },
  MARKET_DATA_INVALID_RESPONSE: {
    statusCode: 502,
    message: "Market data provider returned an invalid response.",
  },
  MARKET_DATA_PROVIDER_UNAVAILABLE: {
    statusCode: 503,
    message: "Market data provider is temporarily unavailable.",
  },
});

function createMarketDataError(message, statusCode, code) {
  return new AppError(message, { statusCode, code });
}

function createDomainError(code) {
  const definition = DOMAIN_ERROR_DEFINITIONS[code];
  if (!definition) {
    const fallback = DOMAIN_ERROR_DEFINITIONS.MARKET_DATA_PROVIDER_UNAVAILABLE;
    return createMarketDataError(
      fallback.message,
      fallback.statusCode,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    );
  }
  return createMarketDataError(definition.message, definition.statusCode, code);
}

function mapProviderError(error) {
  if (
    error?.isOperational &&
    typeof error.code === "string" &&
    error.code.startsWith("MARKET_DATA_")
  ) {
    return createDomainError(error.code);
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
    return createDomainError("MARKET_DATA_RATE_LIMITED");
  }

  if (
    status === 408 ||
    status === 504 ||
    error?.code === "ECONNABORTED" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ESOCKETTIMEDOUT" ||
    error?.code === "ERR_SOCKET_TIMEOUT" ||
    error?.name === "TimeoutError" ||
    /timeout|timed out/i.test(String(error?.message || ""))
  ) {
    return createDomainError("MARKET_DATA_TIMEOUT");
  }

  if (
    status === 404 ||
    String(providerCode) === "-1121" ||
    /no data|not found|invalid (?:trading )?symbol|unknown symbol|unsupported symbol/i.test(
      String(providerMessage || ""),
    )
  ) {
    return createDomainError("MARKET_DATA_NOT_FOUND");
  }

  if (status === 401 || status === 403) {
    return createDomainError("MARKET_DATA_INVALID_CREDENTIALS");
  }

  if (status === 400 || status === 422) {
    return createDomainError("MARKET_DATA_INVALID_REQUEST");
  }

  return createDomainError("MARKET_DATA_PROVIDER_UNAVAILABLE");
}

module.exports = {
  createMarketDataError,
  mapProviderError,
};
