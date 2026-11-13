const { EventEmitter } = require("events");

const mockQuit = jest.fn(async () => {
  mockClient.status = "end";
  return "OK";
});

const mockDisconnect = jest.fn(() => {
  mockClient.status = "end";
});

const mockClient = new EventEmitter();

mockClient.connect = jest.fn(async () => {
  mockClient.status = "ready";
});
mockClient.quit = mockQuit;
mockClient.disconnect = mockDisconnect;

let disconnectRedis;

describe("Redis shutdown", () => {
  beforeEach(() => {
    // setupAfterEnv.js loads the real config/redis module before this file
    // runs, so reset the registry to exercise the disposable mock instead.
    jest.resetModules();
    jest.doMock("ioredis", () => jest.fn(() => mockClient));
    ({ disconnectRedis } = require("../../../src/config/redis"));
    mockClient.status = "ready";
  });

  afterEach(() => {
    mockQuit.mockClear();
    mockDisconnect.mockClear();
  });

  it("shares one quit call across concurrent disconnect requests", async () => {
    await Promise.all([disconnectRedis(), disconnectRedis(), disconnectRedis()]);

    expect(mockQuit).toHaveBeenCalledTimes(1);
    expect(mockClient.status).toBe("end");

    // A later cleanup hook is a no-op once the client has ended.
    await disconnectRedis();

    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it("closes a lazy client without opening a connection", async () => {
    mockClient.status = "wait";

    await disconnectRedis();

    expect(mockQuit).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockClient.status).toBe("end");
  });

  it("does not fail when quit races an already-closed connection", async () => {
    mockQuit.mockImplementationOnce(async () => {
      mockClient.status = "end";
      throw new Error("Connection is closed.");
    });

    await expect(disconnectRedis()).resolves.toBeUndefined();

    expect(mockClient.status).toBe("end");
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
