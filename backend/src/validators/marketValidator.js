const { z } = require("zod");

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

module.exports = { cryptoQuoteParamsSchema };
