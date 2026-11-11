const { disconnectRedis } = require("../src/config/redis");

afterAll(async () => {
  await disconnectRedis();
});
