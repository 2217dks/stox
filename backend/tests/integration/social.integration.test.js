const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const user1 = {
  name: "Social Integration User 1",
  email: `social-integration-1-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const user2 = {
  name: "Social Integration User 2",
  email: `social-integration-2-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const MISSING_USER_ID = "00000000-0000-4000-8000-000000000000";

let user1Id;
let user2Id;

let user1AccessToken;
let user2AccessToken;

beforeAll(async () => {
  jest.setTimeout(15000);

  const registration1 = await request(app)
    .post("/api/v1/auth/register")
    .send(user1);

  expect([200, 201]).toContain(registration1.status);
  user1Id = registration1.body.data.user.id;
  user1AccessToken = registration1.body.data.accessToken;

  const registration2 = await request(app)
    .post("/api/v1/auth/register")
    .send(user2);

  expect([200, 201]).toContain(registration2.status);
  user2Id = registration2.body.data.user.id;
  user2AccessToken = registration2.body.data.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [user1Id, user2Id].filter(Boolean),
      },
    },
  });

  await prisma.$disconnect();
});

describe("Social integration API", () => {
  let postId;

  test("rejects unauthenticated feed requests", async () => {
    const response = await request(app).get("/api/v1/social/feed");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("follows another user", async () => {
    const response = await request(app)
      .post(`/api/v1/social/follow/${user2Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.follow.followerId).toBe(user1Id);
    expect(response.body.data.follow.followingId).toBe(user2Id);
  });

  test("rejects a duplicate follow", async () => {
    const response = await request(app)
      .post(`/api/v1/social/follow/${user2Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_FOLLOWING");
  });

  test("rejects following yourself", async () => {
    const response = await request(app)
      .post(`/api/v1/social/follow/${user1Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANNOT_FOLLOW_SELF");
  });

  test("rejects following a missing user", async () => {
    const response = await request(app)
      .post(`/api/v1/social/follow/${MISSING_USER_ID}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("USER_NOT_FOUND");
  });

  test("rejects a malformed follow target", async () => {
    const response = await request(app)
      .post("/api/v1/social/follow/not-a-uuid")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("lists who the caller follows", async () => {
    const response = await request(app)
      .get("/api/v1/social/following")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);

    const following = response.body.data.following;

    expect(following).toHaveLength(1);
    expect(following[0].id).toBe(user2Id);
  });

  test("lists the followers of a user", async () => {
    const response = await request(app)
      .get("/api/v1/social/followers")
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(response.status).toBe(200);

    const followers = response.body.data.followers;

    expect(followers).toHaveLength(1);
    expect(followers[0].id).toBe(user1Id);
  });

  test("creates a social post", async () => {
    const response = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${user2AccessToken}`)
      .send({
        content: "Opened a new position.",
        symbol: "btcusdt",
        metadata: { kind: "trade" },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const post = response.body.data.post;

    expect(post.authorId).toBe(user2Id);
    expect(post.content).toBe("Opened a new position.");
    expect(post.symbol).toBe("BTCUSDT");
    expect(post.author.id).toBe(user2Id);

    postId = post.id;
  });

  test("rejects an empty social post", async () => {
    const response = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${user2AccessToken}`)
      .send({ content: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns the social feed", async () => {
    const response = await request(app)
      .get("/api/v1/social/feed")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { posts, pagination } = response.body.data;

    expect(pagination.total).toBeGreaterThanOrEqual(1);
    expect(posts.some((post) => post.id === postId)).toBe(true);
  });

  test("unfollows a user", async () => {
    const response = await request(app)
      .delete(`/api/v1/social/follow/${user2Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.unfollowed).toBe(true);
  });

  test("rejects unfollowing a user that is not followed", async () => {
    const response = await request(app)
      .delete(`/api/v1/social/follow/${user2Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOLLOWING");
  });
});
