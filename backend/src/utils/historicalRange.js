const INTERVAL_MILLISECONDS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  // Calendar months vary in length; 31 days is a conservative upper bound.
  "1M": 31 * 24 * 60 * 60_000,
});

const DEFAULT_HISTORICAL_LIMIT = 500;
const MAX_HISTORICAL_LIMIT = 1000;

function isValidHistoricalRange({
  interval,
  from,
  to,
  limit,
  now = Date.now(),
}) {
  const intervalMilliseconds = INTERVAL_MILLISECONDS[interval];
  return Boolean(
    intervalMilliseconds &&
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= MAX_HISTORICAL_LIMIT &&
    from >= 0 &&
    from < to &&
    to <= now &&
    to - from <= intervalMilliseconds * limit,
  );
}

module.exports = {
  DEFAULT_HISTORICAL_LIMIT,
  INTERVAL_MILLISECONDS,
  MAX_HISTORICAL_LIMIT,
  isValidHistoricalRange,
};
