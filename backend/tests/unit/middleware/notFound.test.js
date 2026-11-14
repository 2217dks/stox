const notFoundHandler = require("../../../src/middleware/notFound");

describe("not found handler", () => {
  test("produces a ROUTE_NOT_FOUND AppError", () => {
    const next = jest.fn();

    notFoundHandler({ method: "GET", originalUrl: "/api/v1/nope" }, {}, next);

    const error = next.mock.calls[0][0];

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("ROUTE_NOT_FOUND");
    expect(error.message).toBe("Route GET /api/v1/nope not found.");
  });

  test("does not reflect the query string into the message", () => {
    const next = jest.fn();

    notFoundHandler(
      { method: "GET", originalUrl: "/api/v1/nope?token=super-secret" },
      {},
      next,
    );

    const error = next.mock.calls[0][0];

    expect(error.message).toBe("Route GET /api/v1/nope not found.");
    expect(error.message).not.toContain("super-secret");
  });
});
