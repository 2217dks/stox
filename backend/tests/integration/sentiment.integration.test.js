const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const buildUser = (index) => ({
  name: `Sentiment User ${index}`,
  email: `sentiment-user-${index}-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
});

let userTokens = [];
let userIds = [];

beforeAll(async () => {
  jest.setTimeout(25000);

  for (let i = 1; i <= 6; i++) {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(buildUser(i));
    expect([200, 201]).toContain(res.status);
    userIds.push(res.body.data.user.id);
    userTokens.push(res.body.data.accessToken);
  }
});

afterAll(async () => {
  await prisma.sentimentVote.deleteMany({
    where: {
      userId: { in: userIds },
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: { in: userIds },
    },
  });

  await prisma.$disconnect();
});

describe("Sentiment API integration", () => {
  const testSymbol = `TEST${timestamp % 10000}`;

  afterEach(async () => {
    await prisma.sentimentVote.deleteMany({
      where: { symbol: testSymbol },
    });
  });

  test("rejects unauthenticated sentiment voting", async () => {
    const res = await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .send({ sentiment: "BULLISH" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("validates sentiment vote payload", async () => {
    const res = await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[0]}`)
      .send({ sentiment: "VERY_BULLISH" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("records and updates a sentiment vote idempotently", async () => {
    const voteRes = await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[0]}`)
      .send({ sentiment: "BULLISH" });

    expect(voteRes.status).toBe(200);
    expect(voteRes.body.success).toBe(true);
    expect(voteRes.body.data.vote.sentiment).toBe("BULLISH");
    expect(voteRes.body.data.vote.symbol).toBe(testSymbol);

    // Update vote to BEARISH
    const updateRes = await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[0]}`)
      .send({ sentiment: "BEARISH" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.vote.sentiment).toBe("BEARISH");

    const totalVotes = await prisma.sentimentVote.count({
      where: { symbol: testSymbol, userId: userIds[0] },
    });
    expect(totalVotes).toBe(1);
  });

  test("reports ZERO_VOTES when no votes exist", async () => {
    const res = await request(app).get(`/api/v1/sentiment/${testSymbol}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      symbol: testSymbol,
      totalVotes: 0,
      sampleThreshold: 5,
      sampleThresholdMet: false,
      classification: "NO_DATA",
      status: "ZERO_VOTES",
    });
  });

  test("reports INSUFFICIENT_SAMPLE when total votes < 5", async () => {
    // 3 votes submitted
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BULLISH" });
    }

    const res = await request(app).get(`/api/v1/sentiment/${testSymbol}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      symbol: testSymbol,
      totalVotes: 3,
      sampleThreshold: 5,
      sampleThresholdMet: false,
      classification: "NO_DATA",
      status: "INSUFFICIENT_SAMPLE",
      percentages: {
        bullish: 100,
        bearish: 0,
        neutral: 0,
      },
    });
  });

  test("classifies BULLISH when sample >= 5 and bullish > 50%", async () => {
    // 4 BULLISH, 1 BEARISH (total 5: 80% bullish)
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BULLISH" });
    }
    await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[4]}`)
      .send({ sentiment: "BEARISH" });

    const res = await request(app)
      .get(`/api/v1/sentiment/${testSymbol}`)
      .set("Authorization", `Bearer ${userTokens[0]}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      symbol: testSymbol,
      totalVotes: 5,
      sampleThresholdMet: true,
      classification: "BULLISH",
      status: "BULLISH_CONSENSUS",
      userVote: "BULLISH",
    });
    expect(res.body.data.percentages.bullish).toBe(80);
    expect(res.body.data.percentages.bearish).toBe(20);
  });

  test("classifies BEARISH when sample >= 5 and bearish > 50%", async () => {
    // 4 BEARISH, 1 NEUTRAL (total 5: 80% bearish)
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BEARISH" });
    }
    await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[4]}`)
      .send({ sentiment: "NEUTRAL" });

    const res = await request(app).get(`/api/v1/sentiment/${testSymbol}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      symbol: testSymbol,
      totalVotes: 5,
      sampleThresholdMet: true,
      classification: "BEARISH",
      status: "BEARISH_CONSENSUS",
    });
    expect(res.body.data.percentages.bearish).toBe(80);
    expect(res.body.data.percentages.neutral).toBe(20);
  });

  test("classifies NEUTRAL when sample >= 5 but neither bullish nor bearish exceeds 50%", async () => {
    // 2 BULLISH, 2 BEARISH, 2 NEUTRAL (total 6: 33.33% each)
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BULLISH" });
    }
    for (let i = 2; i < 4; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BEARISH" });
    }
    for (let i = 4; i < 6; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "NEUTRAL" });
    }

    const res = await request(app).get(`/api/v1/sentiment/${testSymbol}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      symbol: testSymbol,
      totalVotes: 6,
      sampleThresholdMet: true,
      classification: "NEUTRAL",
      status: "NEUTRAL_CONSENSUS",
    });
  });

  test("filters votes by time window and reflects recency updates", async () => {
    // 5 votes created 2 days ago (outside 24h window)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    for (let i = 0; i < 5; i++) {
      await prisma.sentimentVote.create({
        data: {
          userId: userIds[i],
          symbol: testSymbol,
          sentiment: "BULLISH",
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
        },
      });
    }

    // In 24h window: 0 votes
    const res24h = await request(app).get(
      `/api/v1/sentiment/${testSymbol}?window=24h`,
    );
    expect(res24h.status).toBe(200);
    expect(res24h.body.data.totalVotes).toBe(0);

    // In 7d window: 5 votes
    const res7d = await request(app).get(
      `/api/v1/sentiment/${testSymbol}?window=7d`,
    );
    expect(res7d.status).toBe(200);
    expect(res7d.body.data.totalVotes).toBe(5);

    // User 0 updates vote now -> updatedAt becomes recent -> counts in 24h window
    await request(app)
      .post(`/api/v1/sentiment/${testSymbol}/vote`)
      .set("Authorization", `Bearer ${userTokens[0]}`)
      .send({ sentiment: "BEARISH" });

    const refreshed24h = await request(app).get(
      `/api/v1/sentiment/${testSymbol}?window=24h`,
    );
    expect(refreshed24h.status).toBe(200);
    expect(refreshed24h.body.data.totalVotes).toBe(1);
    expect(refreshed24h.body.data.breakdown.bearish).toBe(1);
  });

  test("excludes suspended users from sentiment aggregation", async () => {
    // Submit 5 votes
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/sentiment/${testSymbol}/vote`)
        .set("Authorization", `Bearer ${userTokens[i]}`)
        .send({ sentiment: "BULLISH" });
    }

    try {
      // Suspend user 0
      await prisma.user.update({
        where: { id: userIds[0] },
        data: { isSuspended: true },
      });

      const res = await request(app).get(`/api/v1/sentiment/${testSymbol}`);
      expect(res.status).toBe(200);
      // Votes count drops to 4 (below threshold 5)
      expect(res.body.data.totalVotes).toBe(4);
      expect(res.body.data.sampleThresholdMet).toBe(false);
      expect(res.body.data.classification).toBe("NO_DATA");
    } finally {
      await prisma.user.update({
        where: { id: userIds[0] },
        data: { isSuspended: false },
      });
    }
  });
});

