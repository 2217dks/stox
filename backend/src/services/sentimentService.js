const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

const MIN_SAMPLE_THRESHOLD = 5;

async function ensureActiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuspended: true,
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  return user;
}

function serializeVote(vote) {
  return {
    id: vote.id,
    userId: vote.userId,
    symbol: vote.symbol,
    sentiment: vote.sentiment,
    createdAt: vote.createdAt,
    updatedAt: vote.updatedAt,
  };
}

async function recordVote({ userId, symbol, sentiment }) {
  await ensureActiveUser(userId);

  const normalizedSymbol = symbol.trim().toUpperCase();

  const vote = await prisma.sentimentVote.upsert({
    where: {
      userId_symbol: {
        userId,
        symbol: normalizedSymbol,
      },
    },
    create: {
      userId,
      symbol: normalizedSymbol,
      sentiment,
    },
    update: {
      sentiment,
      updatedAt: new Date(),
    },
  });

  return serializeVote(vote);
}

async function getSentiment({
  symbol,
  window = "all",
  viewerId = null,
  now = new Date(),
}) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedWindow = (window || "all").toLowerCase();

  const where = {
    symbol: normalizedSymbol,
    user: {
      isSuspended: false,
    },
  };

  let windowStart = null;
  if (normalizedWindow === "24h") {
    windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (normalizedWindow === "7d") {
    windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (normalizedWindow === "30d") {
    windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  if (windowStart) {
    where.updatedAt = { gte: windowStart };
  }

  const [grouped, viewerVote] = await Promise.all([
    prisma.sentimentVote.groupBy({
      by: ["sentiment"],
      where,
      _count: {
        sentiment: true,
      },
    }),
    viewerId
      ? prisma.sentimentVote.findUnique({
          where: {
            userId_symbol: {
              userId: viewerId,
              symbol: normalizedSymbol,
            },
          },
          select: {
            sentiment: true,
          },
        })
      : null,
  ]);

  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const row of grouped) {
    if (row.sentiment === "BULLISH") bullish = row._count.sentiment;
    if (row.sentiment === "BEARISH") bearish = row._count.sentiment;
    if (row.sentiment === "NEUTRAL") neutral = row._count.sentiment;
  }

  const total = bullish + bearish + neutral;
  const sampleThresholdMet = total >= MIN_SAMPLE_THRESHOLD;

  let classification = "NO_DATA";
  let status = "ZERO_VOTES";
  let percentages = { bullish: 0, bearish: 0, neutral: 0 };

  if (total === 0) {
    classification = "NO_DATA";
    status = "ZERO_VOTES";
  } else if (total < MIN_SAMPLE_THRESHOLD) {
    classification = "NO_DATA";
    status = "INSUFFICIENT_SAMPLE";
    percentages = {
      bullish: Number(((bullish / total) * 100).toFixed(2)),
      bearish: Number(((bearish / total) * 100).toFixed(2)),
      neutral: Number(((neutral / total) * 100).toFixed(2)),
    };
  } else {
    const pB = (bullish / total) * 100;
    const pR = (bearish / total) * 100;
    const pN = (neutral / total) * 100;

    percentages = {
      bullish: Number(pB.toFixed(2)),
      bearish: Number(pR.toFixed(2)),
      neutral: Number(pN.toFixed(2)),
    };

    if (pB > 50 && bullish > bearish) {
      classification = "BULLISH";
      status = "BULLISH_CONSENSUS";
    } else if (pR > 50 && bearish > bullish) {
      classification = "BEARISH";
      status = "BEARISH_CONSENSUS";
    } else {
      classification = "NEUTRAL";
      status = "NEUTRAL_CONSENSUS";
    }
  }

  return {
    symbol: normalizedSymbol,
    window: normalizedWindow,
    totalVotes: total,
    sampleThreshold: MIN_SAMPLE_THRESHOLD,
    sampleThresholdMet,
    classification,
    status,
    breakdown: {
      bullish,
      bearish,
      neutral,
    },
    percentages,
    userVote: viewerVote?.sentiment ?? null,
  };
}

module.exports = {
  MIN_SAMPLE_THRESHOLD,
  recordVote,
  getSentiment,
};
