const axios = require("axios");

const { mapProviderError } = require("./marketDataErrors");

function createHttpClient({ baseURL, timeoutMs, headers = {} }) {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers,
  });
}

async function getData(client, path, params) {
  try {
    const response = await client.get(path, { params });
    return response?.data;
  } catch (error) {
    throw mapProviderError(error);
  }
}

function isFiniteDecimal(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function decimalString(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (!isFiniteDecimal(value)) return undefined;
  return String(value);
}

function isoTimestamp(value, { unit = "milliseconds" } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  const date = new Date(unit === "seconds" ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function invalidProviderResponse() {
  const { createMarketDataError } = require("./marketDataErrors");
  return createMarketDataError(
    "Market data provider returned an invalid response.",
    502,
    "MARKET_DATA_INVALID_RESPONSE",
  );
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidProviderResponse();
  }
  return value;
}

module.exports = {
  createHttpClient,
  getData,
  decimalString,
  isoTimestamp,
  invalidProviderResponse,
  assertObject,
};
