const { Prisma } = require("@prisma/client");

const { toDecimalString } = require("../../../src/utils/decimal");

describe("toDecimalString", () => {
  test("returns null for missing values", () => {
    expect(toDecimalString(null)).toBeNull();
    expect(toDecimalString(undefined)).toBeNull();
  });

  test("formats a Prisma Decimal with the storage scale", () => {
    expect(toDecimalString(new Prisma.Decimal("10000"))).toBe("10000.00000000");
  });

  test("accepts a decimal string and a number", () => {
    expect(toDecimalString("12.5")).toBe("12.50000000");
    expect(toDecimalString(3)).toBe("3.00000000");
  });

  test("honours a custom scale", () => {
    expect(toDecimalString("1.23456", 2)).toBe("1.23");
  });

  test("falls back to zero instead of throwing on invalid input", () => {
    expect(toDecimalString("not-a-number")).toBe("0.00000000");
  });
});
