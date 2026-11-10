// Asset classes the trading pipeline can price and execute end to end.
//
// FOREX remains part of the database enum and the market-data error contract,
// but no provider is wired for it yet. Orders for unsupported classes are
// rejected at placement so they never occupy the pending-order queue, and the
// worker uses the same predicate to reject legacy rows defensively.
const EXECUTABLE_ASSET_TYPES = Object.freeze(["STOCK", "CRYPTO"]);

const EXECUTABLE_ASSET_TYPE_SET = new Set(EXECUTABLE_ASSET_TYPES);

function isExecutableAssetType(assetType) {
  return EXECUTABLE_ASSET_TYPE_SET.has(assetType);
}

module.exports = {
  EXECUTABLE_ASSET_TYPES,
  isExecutableAssetType,
};
