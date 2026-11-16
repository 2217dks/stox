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
const MISSING_POST_ID = "00000000-0000-4000-8000-000000000001";

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
  let hiddenPostId;

  test("rejects unauthenticated feed requests", async () => {
    const response = await request(app).get("/api/v1/social/feed");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects unauthenticated post-detail requests", async () => {
    const response = await request(app).get(
      `/api/v1/social/posts/${MISSING_POST_ID}`,
    );

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
    expect(post.author).toEqual({
      id: user2Id,
      name: user2.name,
      avatarUrl: null,
    });

    postId = post.id;

    const hiddenPost = await prisma.post.create({
      data: {
        authorId: user2Id,
        content: "A hidden post.",
        isHidden: true,
      },
    });

    hiddenPostId = hiddenPost.id;
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
    expect(posts.some((post) => post.id === hiddenPostId)).toBe(false);
  });

  test("returns a public profile with accurate counts and safe fields", async () => {
    const response = await request(app)
      .get(`/api/v1/users/${user2Id}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toEqual({
      id: user2Id,
      name: user2.name,
      avatarUrl: null,
      counts: {
        followers: 1,
        following: 0,
        posts: 1,
      },
      isFollowing: true,
    });
  });

  test("allows anonymous profile reads and returns authenticated relationship state", async () => {
    const anonymous = await request(app).get(`/api/v1/users/${user2Id}`);

    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data.user.isFollowing).toBeNull();

    const nonFollower = await request(app)
      .get(`/api/v1/users/${user1Id}`)
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(nonFollower.status).toBe(200);
    expect(nonFollower.body.data.user.isFollowing).toBe(false);
  });

  test("rejects invalid and missing public-profile IDs", async () => {
    const invalid = await request(app).get("/api/v1/users/not-a-uuid");
    const missing = await request(app).get(`/api/v1/users/${MISSING_USER_ID}`);

    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.error.code).toBe("USER_NOT_FOUND");
  });

  test("returns a visible post with safe author fields", async () => {
    const response = await request(app)
      .get(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.post).toMatchObject({
      id: postId,
      authorId: user2Id,
      content: "Opened a new position.",
      symbol: "BTCUSDT",
      metadata: { kind: "trade" },
      author: {
        id: user2Id,
        name: user2.name,
        avatarUrl: null,
      },
    });

    expect(Object.keys(response.body.data.post.author).sort()).toEqual([
      "avatarUrl",
      "id",
      "name",
    ]);
    expect(response.body.data.post.author).not.toHaveProperty("email");
    expect(response.body.data.post.author).not.toHaveProperty("passwordHash");
  });

  test("returns the same not-found response for missing and hidden posts", async () => {
    const missing = await request(app)
      .get(`/api/v1/social/posts/${MISSING_POST_ID}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    const hidden = await request(app)
      .get(`/api/v1/social/posts/${hiddenPostId}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(missing.status).toBe(404);
    expect(hidden.status).toBe(404);
    expect(missing.body).toEqual(hidden.body);
    expect(missing.body.success).toBe(false);
    expect(missing.body.error.code).toBe("POST_NOT_FOUND");
  });

  test("rejects a malformed post ID", async () => {
    const response = await request(app)
      .get("/api/v1/social/posts/not-a-uuid")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
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

  describe("Social feed ranking and trending mode", () => {
    let user3Id;
    let user3AccessToken;

    beforeAll(async () => {
      const user3 = {
        name: "Social Trending User 3",
        email: `social-trending-3-${timestamp}@example.com`,
        password: "IntegrationTest#2026",
      };

      const registration = await request(app)
        .post("/api/v1/auth/register")
        .send(user3);

      expect([200, 201]).toContain(registration.status);
      user3Id = registration.body.data.user.id;
      user3AccessToken = registration.body.data.accessToken;
    });

    afterAll(async () => {
      if (user3Id) {
        await prisma.user.deleteMany({
          where: { id: user3Id },
        });
      }
    });

    test("rejects invalid feed query parameters", async () => {
      const invalidSort = await request(app)
        .get("/api/v1/social/feed?sort=viral")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(invalidSort.status).toBe(400);

      const invalidAsOf = await request(app)
        .get("/api/v1/social/feed?asOf=not-a-valid-date")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(invalidAsOf.status).toBe(400);
    });

    test("ranks posts by trending formula accounting for likes, age decay, and following boost", async () => {
      const asOf = "2026-11-15T12:00:00.000Z";

      // Post A: author = user2, 1 hour old at asOf, 0 likes
      const postA = await prisma.post.create({
        data: {
          authorId: user2Id,
          content: "Post A: Recent without likes",
          createdAt: new Date("2026-11-15T11:00:00.000Z"),
        },
      });

      // Post B: author = user3, 2 hours old at asOf, 2 likes
      const postB = await prisma.post.create({
        data: {
          authorId: user3Id,
          content: "Post B: Older with likes",
          createdAt: new Date("2026-11-15T10:00:00.000Z"),
        },
      });

      // Add 2 likes to Post B (from user2 and user3)
      await prisma.postLike.createMany({
        data: [
          { postId: postB.id, userId: user2Id },
          { postId: postB.id, userId: user3Id },
        ],
      });

      try {
        // Ensure user1 does NOT follow user2 or user3 initially
        await prisma.follow.deleteMany({
          where: {
            followerId: user1Id,
            followingId: { in: [user2Id, user3Id] },
          },
        });

        // 1. Unfollowed: Post B score (3 / 4^1.2 ≈ 0.568) > Post A score (1 / 3^1.2 ≈ 0.268)
        const unfollowedRes = await request(app)
          .get(`/api/v1/social/feed?sort=trending&asOf=${asOf}`)
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(unfollowedRes.status).toBe(200);
        const posts = unfollowedRes.body.data.posts;
        const indexA = posts.findIndex((p) => p.id === postA.id);
        const indexB = posts.findIndex((p) => p.id === postB.id);

        expect(indexB).toBeGreaterThanOrEqual(0);
        expect(indexA).toBeGreaterThanOrEqual(0);
        expect(indexB).toBeLessThan(indexA);

        // 2. Follow user2: Post A gains following boost (+2 in numerator)
        // Post A score becomes 3 / 3^1.2 ≈ 0.803 > Post B score 0.568
        await prisma.follow.create({
          data: {
            followerId: user1Id,
            followingId: user2Id,
          },
        });

        const followedRes = await request(app)
          .get(`/api/v1/social/feed?sort=trending&asOf=${asOf}`)
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(followedRes.status).toBe(200);
        const followedPosts = followedRes.body.data.posts;
        const newIndexA = followedPosts.findIndex((p) => p.id === postA.id);
        const newIndexB = followedPosts.findIndex((p) => p.id === postB.id);

        expect(newIndexA).toBeLessThan(newIndexB);
      } finally {
        await prisma.post.deleteMany({
          where: { id: { in: [postA.id, postB.id] } },
        });
        await prisma.follow.deleteMany({
          where: {
            followerId: user1Id,
            followingId: { in: [user2Id, user3Id] },
          },
        });
      }
    });

    test("excludes posts older than 7 days from trending candidate window", async () => {
      const asOf = "2026-11-15T12:00:00.000Z";

      // Post 8 days old (beyond 7 days)
      const oldPost = await prisma.post.create({
        data: {
          authorId: user2Id,
          content: "Post beyond 7 days window",
          createdAt: new Date("2026-11-07T11:00:00.000Z"),
        },
      });

      try {
        const res = await request(app)
          .get(`/api/v1/social/feed?sort=trending&asOf=${asOf}`)
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.posts.some((p) => p.id === oldPost.id)).toBe(false);
      } finally {
        await prisma.post.deleteMany({
          where: { id: oldPost.id },
        });
      }
    });

    test("strictly excludes suspended authors from feed", async () => {
      const testPost = await prisma.post.create({
        data: {
          authorId: user3Id,
          content: "Post by suspended author",
        },
      });

      try {
        await prisma.user.update({
          where: { id: user3Id },
          data: { isSuspended: true },
        });

        const latestRes = await request(app)
          .get("/api/v1/social/feed?sort=latest")
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(latestRes.status).toBe(200);
        expect(latestRes.body.data.posts.some((p) => p.id === testPost.id)).toBe(false);

        const trendingRes = await request(app)
          .get("/api/v1/social/feed?sort=trending")
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(trendingRes.status).toBe(200);
        expect(trendingRes.body.data.posts.some((p) => p.id === testPost.id)).toBe(false);
      } finally {
        await prisma.user.update({
          where: { id: user3Id },
          data: { isSuspended: false },
        });
        await prisma.post.deleteMany({
          where: { id: testPost.id },
        });
      }
    });
  });
});
