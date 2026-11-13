/**
 * Convert a client/provider symbol into the internal representation used by
 * rooms, cache keys, listeners, and realtime payloads.
 *
 * The `BINANCE:` prefix is a provider transport detail, not part of the
 * instrument identity. Keeping this in one place prevents the socket layer and
 * the market stream from disagreeing about which symbol a room represents.
 */
function toInternalSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^BINANCE:/, "");
}

module.exports = {
  toInternalSymbol,
};
