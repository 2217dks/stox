jest.mock("axios", () => ({ create: jest.fn(() => ({ get: jest.fn() })) }));
jest.mock("../../../src/utils/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
}));

const axios = require("axios");
const logger = require("../../../src/utils/logger");
const errorHandler = require("../../../src/middleware/errorHandler");
const {
  createMarketDataError,
  mapProviderError,
} = require("../../../src/providers/marketDataErrors");
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

  test.each([
    ["HTTP 408", { response: { status: 408 } }],
    ["HTTP 504", { response: { status: 504 } }],
    ["Axios timeout", { code: "ECONNABORTED", message: "timeout exceeded" }],
    ["socket timeout", { code: "ESOCKETTIMEDOUT" }],
  ])("maps %s to the stable timeout error", async (_label, failure) => {
    await expect(
      getData({ get: jest.fn().mockRejectedValue(failure) }, "/quote", {}),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "MARKET_DATA_TIMEOUT",
      message: "Market data provider request timed out.",
    });
  });

  test.each([418, 429])(
    "maps HTTP %i to the stable rate-limit error",
    async (status) => {
      await expect(
        getData(
          { get: jest.fn().mockRejectedValue({ response: { status } }) },
          "/quote",
          {},
        ),
      ).rejects.toMatchObject({
        statusCode: 429,
        code: "MARKET_DATA_RATE_LIMITED",
        message: "Market data provider rate limit reached.",
      });
    },
  );

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

  test("maps invalid provider request responses without exposing provider text", async () => {
    await expect(
      getData(
        {
          get: jest.fn().mockRejectedValue({
            response: {
              status: 400,
              data: { error: "invalid symbol containing secret token" },
            },
          }),
        },
        "/quote",
        {},
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
      message: "Market data is unavailable for the requested symbol or range.",
    });
  });

  test("maps unexpected provider failures to a safe unavailable error", async () => {
    const failure = {
      code: "ECONNRESET",
      message: "token=provider-secret raw response data",
      response: { status: 503, data: { error: "raw provider body" } },
    };
    const error = await getData(
      { get: jest.fn().mockRejectedValue(failure) },
      "/quote",
      {},
    ).catch((caught) => caught);

    expect(error).toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      message: "Market data provider is temporarily unavailable.",
      details: null,
    });
    expect(`${error.message}${error.stack}`).not.toContain("provider-secret");
    expect(`${error.message}${error.stack}`).not.toContain("raw provider body");
  });

  test("sanitizes operational market-data errors before the error envelope and logs", () => {
    const unsafe = createMarketDataError(
      "upstream token=provider-secret",
      503,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    );
    unsafe.details = { response: "raw provider body" };
    const error = mapProviderError(unsafe);
    const response = {
      statusCode: null,
      body: null,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    logger.error.mockClear();

    errorHandler(
      error,
      { method: "GET", originalUrl: "/api/v1/market/quote/AAPL" },
      response,
      () => {},
    );

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: "Market data provider is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "provider-secret",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "raw provider body",
    );
  });
});
