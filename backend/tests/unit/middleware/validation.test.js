const validate = require("../../../src/middleware/validation");
const { z } = require("zod");

describe("validation middleware", () => {
  test("validates and replaces req.body", () => {
    const schema = z.object({
      name: z.string().trim(),
    });

    const req = {
      body: {
        name: "  Dakshesh  ",
      },
    };

    const next = jest.fn();

    validate(schema)(req, {}, next);

    expect(req.body).toEqual({
      name: "Dakshesh",
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("validates and replaces req.query", () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1),
    });

    const req = {
      query: {
        page: "2",
      },
    };

    const next = jest.fn();

    validate(schema, "query")(req, {}, next);

    expect(req.query).toEqual({
      page: 2,
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("validates and replaces req.params", () => {
    const schema = z.object({
      userId: z.string().uuid(),
    });

    const userId = "550e8400-e29b-41d4-a716-446655440000";

    const req = {
      params: {
        userId,
      },
    };

    const next = jest.fn();

    validate(schema, "params")(req, {}, next);

    expect(req.params).toEqual({
      userId,
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("forwards validation errors", () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1),
    });

    const req = {
      query: {
        page: "0",
      },
    };

    const next = jest.fn();

    expect(() => validate(schema, "query")(req, {}, next)).toThrow();

    expect(next).not.toHaveBeenCalled();
  });
});
