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
 * Sequence allocation is serialized using the parent Order row:
 * 1. An exclusive row lock (`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`)
 *    is acquired on the parent Order row. Because the Order row is a stable,
 *    permanent anchor for the order's entire lifecycle, locking it serializes
 *    all concurrent transitions and event allocations for this order.
 * 2. Under this lock, the highest existing sequence for this order is determined
 *    and incremented (or 1 if no events exist yet), guaranteeing gapless,
 *    strictly monotonic sequence allocation without race conditions.
 * 3. An explicit sequence can still be supplied if needed.
 * 4. The unique constraint on (orderId, sequence) serves as a database-level invariant.
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

  // 1. Serialize sequence allocation and event writes using the parent Order row.
  const orderRows = await tx.$queryRaw`
    SELECT "id"
    FROM "Order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;

  if (!orderRows || orderRows.length === 0) {
    throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
  }

  let eventSequence = sequence;

  if (typeof eventSequence !== "number") {
    if (typeof tx.orderEvent?.findFirst === "function") {
      const latest = await tx.orderEvent.findFirst({
        where: { orderId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      eventSequence = latest ? latest.sequence + 1 : 1;
    } else {
      const latestRows = await tx.$queryRaw`
        SELECT "sequence"
        FROM "OrderEvent"
        WHERE "orderId" = ${orderId}
        ORDER BY "sequence" DESC
        LIMIT 1
      `;
      eventSequence =
        latestRows.length > 0 && latestRows[0]?.sequence != null
          ? Number(latestRows[0].sequence) + 1
          : 1;
    }
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

