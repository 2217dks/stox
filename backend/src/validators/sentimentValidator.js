const { z } = require("zod");

const sentimentEnum = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);

const symbolParamsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(20, "Symbol is too long.")
    .transform((val) => val.toUpperCase()),
});

const voteSentimentSchema = z.object({
  sentiment: sentimentEnum,
});

const windowEnum = z.enum([
  "24h",
  "7d",
  "30d",
  "all",
  "ALL",
  "24H",
  "7D",
  "30D",
]);

const sentimentQuerySchema = z.object({
  window: windowEnum.default("all").transform((val) => val.toLowerCase()),
});

module.exports = {
  sentimentEnum,
  symbolParamsSchema,
  voteSentimentSchema,
  sentimentQuerySchema,
};

