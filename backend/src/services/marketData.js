require("dotenv").config();

const { loadMarketDataConfig } = require("../config/marketDataConfig");
const {
  createMarketDataProviders,
} = require("../providers/createMarketDataProviders");
const { createMarketDataService } = require("./marketDataService");

const config = loadMarketDataConfig();

module.exports = createMarketDataService({
  config,
  providers: createMarketDataProviders(config),
});
