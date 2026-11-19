const { Prisma } = require("@prisma/client");

const ZERO = new Prisma.Decimal(0);

/**
 * Serialize a monetary value as a fixed-scale decimal string.
 *
 * Prisma Decimal values must never be sent as JSON numbers: binary floating
 * point loses cents. Invalid or missing input becomes zero rather than
 * throwing, because these values are read paths that must still render.
 */
function toDecimalString(value, decimals = 8) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    const decimal = value instanceof Prisma.Decimal
      ? value
      : new Prisma.Decimal(value);

    return decimal.toFixed(decimals);
  } catch {
    return ZERO.toFixed(decimals);
  }
}

module.exports = { toDecimalString };
