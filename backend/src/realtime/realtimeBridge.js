/**
 * Forward bus messages onto Socket.IO namespaces/rooms.
 *
 * The worker process publishes; this bridge runs in the API process and is the
 * only place that knows about Socket.IO. Keeping it separate is what makes the
 * execution path testable without a Socket.IO server.
 */
async function startRealtimeBridge({ io, bus }) {
  if (!io) {
    throw new TypeError("startRealtimeBridge requires a Socket.IO server.");
  }

  if (!bus || typeof bus.subscribe !== "function") {
    throw new TypeError("startRealtimeBridge requires a subscribable bus.");
  }

  const unsubscribe = await bus.subscribe((message) => {
    if (!message || !message.namespace || !message.event) {
      return;
    }

    const namespace = io.of(message.namespace);
    const target = message.room ? namespace.to(message.room) : namespace;

    target.emit(message.event, message.payload);
  });

  return {
    stop() {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    },
  };
}

module.exports = {
  startRealtimeBridge,
};
