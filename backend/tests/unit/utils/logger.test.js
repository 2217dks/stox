const {
  redactSensitive,
  childLogger,
  REDACTED,
} = require("../../../src/utils/logger");

describe("structured logging helpers", () => {
  describe("redactSensitive", () => {
    test("masks credential-bearing keys at any depth", () => {
      const redacted = redactSensitive({
        email: "user@stox.local",
        password: "hunter2",
        nested: {
          authorization: "Bearer abc.def.ghi",
          refreshToken: "refresh-value",
          apiKey: "key-value",
          cookie: "session=abc",
          secret: "shh",
        },
      });

      expect(redacted.email).toBe("user@stox.local");
      expect(redacted.password).toBe(REDACTED);
      expect(redacted.nested.authorization).toBe(REDACTED);
      expect(redacted.nested.refreshToken).toBe(REDACTED);
      expect(redacted.nested.apiKey).toBe(REDACTED);
      expect(redacted.nested.cookie).toBe(REDACTED);
      expect(redacted.nested.secret).toBe(REDACTED);
    });

    test("masks values inside arrays", () => {
      const redacted = redactSensitive([
        { token: "one" },
        { password: "two" },
        { safe: "three" },
      ]);

      expect(redacted[0].token).toBe(REDACTED);
      expect(redacted[1].password).toBe(REDACTED);
      expect(redacted[2].safe).toBe("three");
    });

    test("does not mutate the input object", () => {
      const input = { password: "hunter2" };

      redactSensitive(input);

      expect(input.password).toBe("hunter2");
    });

    test("stops at the depth limit instead of recursing forever", () => {
      const deep = { a: { b: { c: { d: { password: "nested-secret" } } } } };

      expect(() => redactSensitive(deep, 2)).not.toThrow();
      expect(JSON.stringify(redactSensitive(deep, 2))).not.toContain(
        "nested-secret",
      );
    });

    test("preserves primitives and null", () => {
      expect(redactSensitive(null)).toBeNull();
      expect(redactSensitive("text")).toBe("text");
      expect(redactSensitive(42)).toBe(42);
    });
  });

  describe("childLogger", () => {
    test("returns the standard logger interface", () => {
      const child = childLogger({ queue: "orders", jobId: "job-1" });

      for (const method of ["info", "warn", "error", "debug"]) {
        expect(typeof child[method]).toBe("function");
      }
    });

    test("forwards calls with merged context", () => {
      const logger = require("../../../src/utils/logger");
      const spy = jest.spyOn(logger, "info").mockImplementation(() => {});

      try {
        const child = childLogger({ queue: "orders", jobId: "job-1" });
        child.info("job started", { attempt: 1 });

        expect(spy).toHaveBeenCalledWith("job started", {
          queue: "orders",
          jobId: "job-1",
          attempt: 1,
        });
      } finally {
        spy.mockRestore();
      }
    });

    test("call-site context overrides the child defaults", () => {
      const logger = require("../../../src/utils/logger");
      const spy = jest.spyOn(logger, "warn").mockImplementation(() => {});

      try {
        childLogger({ jobId: "default" }).warn("retrying", { jobId: "explicit" });

        expect(spy).toHaveBeenCalledWith("retrying", { jobId: "explicit" });
      } finally {
        spy.mockRestore();
      }
    });

    test("redacts sensitive context before it reaches the logger", () => {
      const logger = require("../../../src/utils/logger");
      const spy = jest.spyOn(logger, "error").mockImplementation(() => {});

      try {
        childLogger({ queue: "auth" }).error("failed", {
          password: "hunter2",
        });

        const payload = spy.mock.calls[0][1];
        expect(payload.password).toBe(REDACTED);
      } finally {
        spy.mockRestore();
      }
    });

    test("ignores non-object metadata instead of spreading it into keys", () => {
      const logger = require("../../../src/utils/logger");
      const spy = jest.spyOn(logger, "info").mockImplementation(() => {});

      try {
        childLogger({ queue: "orders" }).info("started", "not-an-object");

        expect(spy).toHaveBeenCalledWith("started", { queue: "orders" });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
