const { z } = require("zod");
const {
  DEFAULT_HISTORICAL_LIMIT,
  MAX_HISTORICAL_LIMIT,
  isValidHistoricalRange,
} = require("../utils/historicalRange");

const historicalSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(30)
  .regex(/^[A-Z0-9][A-Z0-9._:/-]*$/, "A valid market symbol is required.");

function queryInteger(value) {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return Number(value);
}

const cryptoQuoteParamsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(30)
    .regex(
      /^(?:BINANCE:)?[A-Z0-9]{2,20}\/?(?:USDT|BTC|ETH)$/,
      "A valid Binance crypto pair is required.",
    ),
});

const historicalPricesParamsSchema = z.object({
  symbol: historicalSymbolSchema,
});

const historicalPricesQuerySchema = z
  .object({
    interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]),
    from: z.preprocess(queryInteger, z.number().int().safe().nonnegative()),
    to: z.preprocess(queryInteger, z.number().int().safe().positive()),
    limit: z.preprocess(
      (value) =>
        value === undefined ? DEFAULT_HISTORICAL_LIMIT : queryInteger(value),
      z.number().int().min(1).max(MAX_HISTORICAL_LIMIT),
    ),
    assetClass: z.enum(["STOCK", "CRYPTO"]).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (!isValidHistoricalRange(query)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message:
          "The end must follow the start, cannot be in the future, and the range must fit within the requested point limit.",
      });
    }
  });

module.exports = {
  cryptoQuoteParamsSchema,
  historicalPricesParamsSchema,
  historicalPricesQuerySchema,
};
