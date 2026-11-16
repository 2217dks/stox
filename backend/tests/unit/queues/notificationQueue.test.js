jest.mock("../../../src/queues/index", () => ({
  getQueue: jest.fn(),
  isQueuesEnabled: jest.fn(),
  closeQueues: jest.fn(),
}));

const { getQueue } = require("../../../src/queues/index");
const {
  enqueueNotificationDelivery,
  listFailedNotificationJobs,
  requeueNotificationDelivery,
  retryFailedNotificationJob,
} = require("../../../src/queues/notificationQueue");
const {
  QUEUE_NAMES,
  NOTIFICATION_JOB_NAMES,
} = require("../../../src/queues/definitions");

const NOTIFICATION_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";

function makeQueue() {
  return {
    add: jest.fn(async (name, data, options) => ({
      id: options?.jobId ?? "job-1",
      name,
      data,
    })),
    getFailed: jest.fn(async () => []),
    getJob: jest.fn(),
  };
}

describe("notification queue", () => {
  let queue;

  beforeEach(() => {
    queue = makeQueue();
    getQueue.mockReturnValue(queue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("rejects a payload without a UUID notification id", async () => {
    await expect(
      enqueueNotificationDelivery({ notificationId: "not-a-uuid" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_JOB_PAYLOAD",
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  test("enqueues send-notification keyed by the notification id", async () => {
    const result = await enqueueNotificationDelivery({
      notificationId: NOTIFICATION_ID,
    });

    expect(result).toEqual({ enqueued: true, jobId: NOTIFICATION_ID });
    expect(queue.add).toHaveBeenCalledWith(
      NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
      { notificationId: NOTIFICATION_ID },
      expect.objectContaining({
        jobId: NOTIFICATION_ID,
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
      }),
    );
  });

  test("is a no-op when queues are disabled", async () => {
    getQueue.mockReturnValue(null);

    const result = await enqueueNotificationDelivery({
      notificationId: NOTIFICATION_ID,
    });

    expect(result).toEqual({ enqueued: false, reason: "QUEUES_DISABLED" });
    expect(queue.add).not.toHaveBeenCalled();
  });

  test("never throws when Redis rejects the enqueue", async () => {
    queue.add.mockRejectedValue(new Error("redis down"));

    const result = await enqueueNotificationDelivery({
      notificationId: NOTIFICATION_ID,
    });

    expect(result).toEqual({ enqueued: false, reason: "ENQUEUE_FAILED" });
  });

  test("maps failed jobs to a safe summary", async () => {
    queue.getFailed.mockResolvedValue([
      {
        id: NOTIFICATION_ID,
        name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
        data: { notificationId: NOTIFICATION_ID },
        attemptsMade: 5,
        opts: { attempts: 5 },
        failedReason: "provider timeout",
        finishedOn: 1700000000000,
      },
    ]);

    const [failed] = await listFailedNotificationJobs();

    expect(failed).toEqual({
      id: NOTIFICATION_ID,
      name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
      data: { notificationId: NOTIFICATION_ID },
      attemptsMade: 5,
      maxAttempts: 5,
      failedReason: "provider timeout",
      failedAt: new Date(1700000000000).toISOString(),
    });
  });

  test("retries a failed notification job", async () => {
    const job = {
      getState: jest.fn(async () => "failed"),
      retry: jest.fn(async () => {}),
    };
    queue.getJob.mockResolvedValue(job);

    await expect(
      retryFailedNotificationJob(NOTIFICATION_ID),
    ).resolves.toEqual({ retried: true, jobId: NOTIFICATION_ID });
    expect(job.retry).toHaveBeenCalledTimes(1);
  });

  describe("requeueNotificationDelivery", () => {
    test("adds a job when no job exists for the notification", async () => {
      queue.getJob.mockResolvedValue(null);

      await expect(
        requeueNotificationDelivery({ notificationId: NOTIFICATION_ID }),
      ).resolves.toEqual({ enqueued: true, jobId: NOTIFICATION_ID });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    test("retries an existing failed job instead of adding a duplicate", async () => {
      const job = {
        getState: jest.fn(async () => "failed"),
        retry: jest.fn(async () => {}),
      };
      queue.getJob.mockResolvedValue(job);

      await expect(
        requeueNotificationDelivery({ notificationId: NOTIFICATION_ID }),
      ).resolves.toEqual({
        enqueued: true,
        jobId: NOTIFICATION_ID,
        retried: true,
      });
      expect(job.retry).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
    });

    test("leaves a waiting job alone", async () => {
      const job = { getState: jest.fn(async () => "waiting") };
      queue.getJob.mockResolvedValue(job);

      await expect(
        requeueNotificationDelivery({ notificationId: NOTIFICATION_ID }),
      ).resolves.toEqual({
        enqueued: false,
        reason: "ALREADY_QUEUED",
        state: "waiting",
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    test("removes a completed job so a stuck PENDING row can be retried", async () => {
      const job = {
        getState: jest.fn(async () => "completed"),
        remove: jest.fn(async () => {}),
      };
      queue.getJob.mockResolvedValue(job);

      await expect(
        requeueNotificationDelivery({ notificationId: NOTIFICATION_ID }),
      ).resolves.toEqual({ enqueued: true, jobId: NOTIFICATION_ID });
      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });
});
