const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

const ORDER_EVENT_TYPES = Object.freeze({
  CREATED: "CREATED",
  EXECUTED: "EXECUTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  REJECTED: "REJECTED",
});

const SERIALIZED_ORDER_EVENT_FIELDS = {
  id: true,
  orderId: true,
  sequence: true,
  eventType: true,
  previousStatus: true,
  newStatus: true,
  metadata: true,
  createdAt: true,
};

function serializeOrderEvent(event) {
  return {
    id: event.id,
    orderId: event.orderId,
    sequence: event.sequence,
    eventType: event.eventType,
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    metadata: event.metadata ?? null,
    createdAt: event.createdAt,
  };
}

/**
 * Record an order lifecycle event within an existing database transaction.
 *
 * Sequence allocation is protected against concurrent transitions:
 * 1. An explicit sequence can be supplied (e.g. 1 at creation).
 * 2. Otherwise, the highest existing sequence for this order is locked FOR UPDATE
 *    inside the caller's transaction, guaranteeing strictly monotonic, collision-free
 *    sequence numbers under concurrency.
 * 3. The unique constraint (orderId, sequence) serves as a database-level invariant.
 */
async function recordOrderEvent(
  tx,
  {
    orderId,
    eventType,
    previousStatus = null,
    newStatus,
    metadata = null,
    sequence,
  },
) {
  if (!tx || typeof tx.orderEvent?.create !== "function") {
    throw new Error(
      "A valid Prisma transaction client is required to record order events.",
    );
  }

  if (!orderId) {
    throw new Error("orderId is required to record an order event.");
  }

  if (!newStatus) {
    throw new Error("newStatus is required to record an order event.");
  }

  let eventSequence = sequence;

  if (typeof eventSequence !== "number") {
    // Acquire a row lock on the latest event row for this order.
    const latestRows = await tx.$queryRaw`
      SELECT "sequence"
      FROM "OrderEvent"
      WHERE "orderId" = ${orderId}
      ORDER BY "sequence" DESC
      LIMIT 1
      FOR UPDATE
    `;

    eventSequence =
      latestRows.length > 0 ? Number(latestRows[0].sequence) + 1 : 1;
  }

  return tx.orderEvent.create({
    data: {
      orderId,
      sequence: eventSequence,
      eventType,
      previousStatus,
      newStatus,
      metadata: metadata ?? undefined,
    },
  });
}

/**
 * Retrieve the chronological lifecycle events of an order for an authenticated owner.
 */
async function getOrderEvents({ userId, orderId }) {
  if (!userId || !orderId) {
    throw AppError.badRequest("userId and orderId are required.");
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      portfolio: {
        userId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!order) {
    throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
  }

  const events = await prisma.orderEvent.findMany({
    where: {
      orderId,
    },
    select: SERIALIZED_ORDER_EVENT_FIELDS,
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  return events.map(serializeOrderEvent);
}

module.exports = {
  ORDER_EVENT_TYPES,
  SERIALIZED_ORDER_EVENT_FIELDS,
  serializeOrderEvent,
  recordOrderEvent,
  getOrderEvents,
};

