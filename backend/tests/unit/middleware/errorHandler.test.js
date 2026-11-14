const errorHandler = require("../../../src/middleware/errorHandler");
const logger = require("../../../src/utils/logger");
const { AppError } = require("../../../src/utils/errors");

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("error handler", () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("strips the query string from the logged url", () => {
    const res = makeRes();

    errorHandler(
      AppError.badRequest("Nope.", "BAD_REQUEST"),
      { method: "GET", originalUrl: "/api/v1/x?token=super-secret", id: "r1" },
      res,
      () => {},
    );

    expect(res.statusCode).toBe(400);
    expect(warnSpy.mock.calls[0][1].url).toBe("/api/v1/x");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("super-secret");
  });

  test("includes the correlation id in the log", () => {
    const res = makeRes();

    errorHandler(
      AppError.notFound("Missing.", "NOT_FOUND"),
      { method: "GET", originalUrl: "/x", id: "req-9" },
      res,
      () => {},
    );

    expect(warnSpy.mock.calls[0][1].requestId).toBe("req-9");
  });

  test("does not crash when a non-Error value is thrown", () => {
    const res = makeRes();

    expect(() =>
      errorHandler(
        "boom",
        { method: "GET", originalUrl: "/x" },
        res,
        () => {},
      ),
    ).not.toThrow();

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("boom");
  });

  test("does not crash when null is passed as the error", () => {
    const res = makeRes();

    expect(() =>
      errorHandler(null, { method: "GET", originalUrl: "/x" }, res, () => {}),
    ).not.toThrow();

    expect(res.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});
