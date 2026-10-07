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

  test("validates and stores parsed req.query in a separate property", () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1),
    });

    const req = {
      query: {
        page: "2",
      },
    };

    const next = jest.fn();

    validate(schema, "query", "validatedQuery")(req, {}, next);

    expect(req.query).toEqual({
      page: "2",
    });

    expect(req.validatedQuery).toEqual({
      page: 2,
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("validates and stores parsed req.params in a separate property", () => {
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

    validate(schema, "params", "validatedParams")(req, {}, next);

    expect(req.params).toEqual({
      userId,
    });

    expect(req.validatedParams).toEqual({
      userId,
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("uses the source property as the destination by default", () => {
    const schema = z.object({
      value: z.string().trim(),
    });

    const req = {
      body: {
        value: "  test  ",
      },
    };

    const next = jest.fn();

    validate(schema)(req, {}, next);

    expect(req.body).toEqual({
      value: "test",
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("throws when validation fails", () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1),
    });

    const req = {
      query: {
        page: "0",
      },
    };

    const next = jest.fn();

    expect(() =>
      validate(schema, "query", "validatedQuery")(req, {}, next),
    ).toThrow();

    expect(next).not.toHaveBeenCalled();
    expect(req.validatedQuery).toBeUndefined();
  });
});
