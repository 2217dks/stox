const { EventEmitter } = require("events");

const requestLogger = require("../../../src/middleware/requestLogger");
const logger = require("../../../src/utils/logger");

function makeRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

describe("request logger middleware", () => {
  let infoSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("logs the correlation id from the request context", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/v1/health",
      id: "req-abc-123",
    };
    const res = makeRes(200);

    requestLogger(req, res, jest.fn());
    res.emit("finish");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][1]).toMatchObject({
      method: "GET",
      url: "/api/v1/health",
      statusCode: 200,
      requestId: "req-abc-123",
    });
  });

  test("includes the authenticated user id when present", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/v1/orders",
      id: "req-abc-123",
      user: { userId: "user-1", role: "USER" },
    };
    const res = makeRes(200);

    requestLogger(req, res, jest.fn());
    res.emit("finish");

    expect(infoSpy.mock.calls[0][1].userId).toBe("user-1");
  });

  test("logs null userId for anonymous requests so the shape is stable", () => {
    const req = { method: "GET", originalUrl: "/api/v1/health", id: "req-1" };
    const res = makeRes(200);

    requestLogger(req, res, jest.fn());
    res.emit("finish");

    expect(infoSpy.mock.calls[0][1]).toHaveProperty("userId", null);
  });

  test("never logs headers, bodies, or the query string of a secret-bearing URL", () => {
    const req = {
      method: "POST",
      originalUrl: "/api/v1/auth/login?password=hunter2",
      id: "req-1",
      body: { password: "hunter2" },
      headers: { authorization: "Bearer secret-token" },
    };
    const res = makeRes(401);

    requestLogger(req, res, jest.fn());
    res.emit("finish");

    const serialized = JSON.stringify(warnSpy.mock.calls);

    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("secret-token");
  });

  test("keeps the level split: info < 400, warn 4xx, error >= 500", () => {
    for (const [statusCode, spy] of [
      [204, infoSpy],
      [404, warnSpy],
      [500, errorSpy],
    ]) {
      const req = { method: "GET", originalUrl: `/x/${statusCode}`, id: "r" };
      const res = makeRes(statusCode);

      requestLogger(req, res, jest.fn());
      res.emit("finish");

      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});
