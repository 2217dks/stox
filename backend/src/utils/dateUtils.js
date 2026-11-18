const { AppError } = require("./errors");

/**
 * Format a Date or date string to UTC 'YYYY-MM-DD'.
 *
 * @param {Date|string|number} date
 * @returns {string|null}
 */
function toUtcDateString(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse and normalize a date input to a UTC day boundary.
 *
 * If isEnd is false (default), resolves to 00:00:00.000 UTC.
 * If isEnd is true, resolves to 23:59:59.999 UTC to ensure end-of-day snapshots
 * and intraday trades recorded on that calendar day are fully included.
 *
 * @param {Date|string|number} dateInput
 * @param {boolean} [isEnd=false]
 * @param {string} [errorCode="INVALID_DATE_RANGE"]
 * @returns {Date|null}
 */
function parseUtcDateBoundary(dateInput, isEnd = false, errorCode = "INVALID_DATE_RANGE") {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw AppError.badRequest("Invalid date parameter format.", errorCode);
  }

  if (isEnd) {
    return new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23,
      59,
      59,
      999,
    ));
  }

  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
}

module.exports = {
  toUtcDateString,
  parseUtcDateBoundary,
};
