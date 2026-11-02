jest.mock("axios", () => ({ create: jest.fn(() => ({ get: jest.fn() })) }));

const axios = require("axios");
const {
  createHttpClient,
  getData,
} = require("../../../src/providers/marketDataHttp");

describe("market data HTTP boundary", () => {
  beforeEach(() => jest.clearAllMocks());

  test("applies the configured request timeout and safe headers", () => {
    createHttpClient({
      baseURL: "https://market.example.test",
      timeoutMs: 2300,
      headers: { Authorization: "Bearer test" },
    });

    expect(axios.create).toHaveBeenCalledWith({
      baseURL: "https://market.example.test",
      timeout: 2300,
      headers: { Authorization: "Bearer test" },
    });
  });

  test("converts HTTP rate-limit errors to the Stox domain error", async () => {
    const client = {
      get: jest.fn().mockRejectedValue({
        response: { status: 429, data: { msg: "private detail" } },
      }),
    };

    await expect(getData(client, "/quote", {})).rejects.toMatchObject({
      statusCode: 429,
      code: "MARKET_DATA_RATE_LIMITED",
      message: "Market data provider rate limit reached.",
    });
  });

  test("converts provider authentication errors without echoing the provider body", async () => {
    const client = {
      get: jest.fn().mockRejectedValue({
        response: { status: 401, data: { error: "secret provider response" } },
      }),
    };

    await expect(getData(client, "/quote", {})).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_INVALID_CREDENTIALS",
      message: "Market data provider credentials are invalid or unavailable.",
    });
  });

  test("maps invalid provider symbols to the standard not-found error", async () => {
    const client = {
      get: jest.fn().mockRejectedValue({
        response: {
          status: 400,
          data: { code: -1121, msg: "Invalid symbol. internal details" },
        },
      }),
    };

    await expect(getData(client, "/quote", {})).rejects.toMatchObject({
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
      message: "Market data is unavailable for the requested symbol or range.",
    });
  });
});
