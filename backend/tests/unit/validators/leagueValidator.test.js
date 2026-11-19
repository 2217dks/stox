const { createLeagueSchema } = require("../../../src/validators/leagueValidator");

const baseLeague = {
  name: "Spring Championship",
  startDate: new Date(Date.now() + 86400000).toISOString(),
  endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
};

describe("createLeagueSchema startingBalance", () => {
  test("rejects a starting balance above the supported maximum", () => {
    expect(() =>
      createLeagueSchema.parse({
        ...baseLeague,
        startingBalance: 10_000_000_000,
      }),
    ).toThrow(/startingBalance/i);
  });

  test("accepts a custom balance within the supported range", () => {
    const parsed = createLeagueSchema.parse({
      ...baseLeague,
      startingBalance: 20000,
    });

    expect(parsed.startingBalance).toBe(20000);
  });

  test("defaults to 10000 when no balance is supplied", () => {
    const parsed = createLeagueSchema.parse(baseLeague);

    expect(parsed.startingBalance).toBe(10000);
  });
});
