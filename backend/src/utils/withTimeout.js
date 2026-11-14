/**
 * Race a promise against a deadline.
 *
 * BullMQ requires `maxRetriesPerRequest: null`, so operations against a
 * disconnected Redis never settle on their own. Every place that must stay
 * responsive (best-effort enqueue, graceful shutdown) bounds the wait here.
 *
 * The timer is `unref`'d and always cleared, so a timeout never keeps the
 * process alive or leaks a handle.
 */
function withTimeout(
  promise,
  timeoutMs,
  { message = "Operation timed out.", code = "TIMEOUT" } = {},
) {
  let timer = null;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, timeoutMs);

    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = {
  withTimeout,
};
