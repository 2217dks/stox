const jwt = require("jsonwebtoken");

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "unit-test-access-secret";

const { authenticateSocket } = require("../../../src/sockets/auth");

const SECRET = process.env.JWT_ACCESS_SECRET;

function signToken(
  payload = { userId: "user-1", role: "TRADER", email: "asha@example.com" },
  options = {},
) {
  return jwt.sign(payload, SECRET, {
    issuer: "stox",
    expiresIn: "5m",
    ...options,
  });
}

function buildSocket({ auth = {}, headers = {} } = {}) {
  return {
    handshake: {
      auth,
      headers,
    },
    data: {},
  };
}

function runMiddleware(socket) {
  return new Promise((resolve) => {
    authenticateSocket(socket, (error) => resolve(error));
  });
}

describe("authenticateSocket", () => {
  it("populates socket.data.user from a valid auth token", async () => {
    const socket = buildSocket({
      auth: { token: signToken() },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeUndefined();
    expect(socket.data.user).toEqual({
      userId: "user-1",
      role: "TRADER",
      email: "asha@example.com",
    });
  });

  it("accepts a Bearer token from the Authorization header", async () => {
    const socket = buildSocket({
      headers: { authorization: `Bearer ${signToken()}` },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeUndefined();
    expect(socket.data.user.userId).toBe("user-1");
  });

  it("treats the bearer scheme as case-insensitive", async () => {
    const socket = buildSocket({
      headers: { authorization: `bEaReR ${signToken()}` },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeUndefined();
    expect(socket.data.user.userId).toBe("user-1");
  });

  it("prefers the handshake auth token over the header", async () => {
    const socket = buildSocket({
      auth: { token: signToken({ userId: "auth-user", role: "ADMIN" }) },
      headers: { authorization: `Bearer ${signToken({ userId: "header-user" })}` },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeUndefined();
    expect(socket.data.user.userId).toBe("auth-user");
  });

  it("rejects a connection with no credentials", async () => {
    const error = await runMiddleware(buildSocket());

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "UNAUTHORIZED" });
  });

  it("rejects a malformed Authorization header", async () => {
    const socket = buildSocket({
      headers: { authorization: signToken() },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "INVALID_AUTH_HEADER" });
  });

  it("rejects an invalid token", async () => {
    const socket = buildSocket({
      auth: { token: "not-a-jwt" },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects an expired token", async () => {
    const socket = buildSocket({
      auth: {
        token: signToken(
          { userId: "user-1", role: "TRADER" },
          { expiresIn: -1 },
        ),
      },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects a token signed with a different secret", async () => {
    const socket = buildSocket({
      auth: {
        token: jwt.sign({ userId: "user-1" }, "wrong-secret", {
          issuer: "stox",
          expiresIn: "5m",
        }),
      },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects a token without a userId claim", async () => {
    const socket = buildSocket({
      auth: { token: signToken({ role: "TRADER" }) },
    });

    const error = await runMiddleware(socket);

    expect(error).toBeInstanceOf(Error);
    expect(error.data).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });
});
