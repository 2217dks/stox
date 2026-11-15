const { withTimeout } = require("../../../src/utils/withTimeout");

describe("withTimeout", () => {
  test("resolves with the underlying value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  test("rejects with a TIMEOUT error when the deadline passes", async () => {
    const never = new Promise(() => {});

    await expect(withTimeout(never, 20)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  test("supports a custom message and code", async () => {
    const never = new Promise(() => {});

    await expect(
      withTimeout(never, 20, {
        message: "enqueue stalled",
        code: "ENQUEUE_TIMEOUT",
      }),
    ).rejects.toMatchObject({
      code: "ENQUEUE_TIMEOUT",
      message: "enqueue stalled",
    });
  });

  test("propagates the original rejection unchanged", async () => {
    const failure = new Error("boom");

    await expect(withTimeout(Promise.reject(failure), 50)).rejects.toBe(
      failure,
    );
  });
});
