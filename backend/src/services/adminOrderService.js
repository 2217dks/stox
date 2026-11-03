const prisma = require("../config/database");
const {
  SERIALIZED_ORDER_FIELDS,
  serializeOrder,
} = require("./orderService");

// The order field set is shared with the user-facing serializer so both views
// can never drift. Administrative context is added explicitly: only the
// portfolio identity/flags and the owner's public-ish account fields an
// administrator needs. Relationship objects are never returned wholesale,
// which keeps credentials, tokens and preferences out of the response.
const ADMIN_ORDER_SELECT = {
  ...SERIALIZED_ORDER_FIELDS,
  portfolio: {
    select: {
      id: true,
      name: true,
      isActive: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
};

function serializeAdminOrder(order) {
  return {
    ...serializeOrder(order),
    portfolio: {
      id: order.portfolio.id,
      name: order.portfolio.name,
      isActive: order.portfolio.isActive,
    },
    owner: {
      id: order.portfolio.user.id,
      name: order.portfolio.user.name,
      email: order.portfolio.user.email,
    },
  };
}

// Unlike the user-facing order list, there is deliberately no ownership
// scope here: administrators are allowed to inspect every portfolio. The
// user-facing `listOrders` keeps its `portfolio.userId` scope untouched.
function buildAdminOrderWhere({
  status,
  symbol,
  side,
  type,
  portfolioId,
  userId,
  from,
  to,
}) {
  const where = {};

  if (status) {
    where.status = {
      in: status,
    };
  }

  if (symbol) {
    where.symbol = symbol;
  }

  if (side) {
    where.side = side;
  }

  if (type) {
    where.type = type;
  }

  if (portfolioId) {
    where.portfolioId = portfolioId;
  }

  if (userId) {
    where.portfolio = {
      userId,
    };
  }

  if (from || to) {
    // Same half-open UTC window as GET /orders: from inclusive, to exclusive.
    // A date-only `to` was normalized by the validator to the following
    // midnight, so the whole selected day is covered.
    where.createdAt = {};

    if (from) {
      where.createdAt.gte = from;
    }

    if (to) {
      where.createdAt.lt = to;
    }
  }

  return where;
}

async function listAdminOrders({
  page = 1,
  limit = 20,
  status,
  symbol,
  side,
  type,
  portfolioId,
  userId,
  from,
  to,
} = {}) {
  const where = buildAdminOrderWhere({
    status,
    symbol,
    side,
    type,
    portfolioId,
    userId,
    from,
    to,
  });

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: ADMIN_ORDER_SELECT,
      // Newest first, with a stable tie-break so page boundaries cannot
      // shuffle rows created in the same millisecond.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.order.count({
      where,
    }),
  ]);

  return {
    orders: orders.map(serializeAdminOrder),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  listAdminOrders,
};
