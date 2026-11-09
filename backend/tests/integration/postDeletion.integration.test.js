const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const author = {
  name: "Post Deletion Author",
  email: `post-deletion-author-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const otherUser = {
  name: "Post Deletion Other User",
  email: `post-deletion-other-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const MISSING_POST_ID = "00000000-0000-4000-8000-000000000099";

let authorId;
let otherUserId;
let authorAccessToken;
let otherUserAccessToken;
let postId;

beforeAll(async () => {
  jest.setTimeout(15000);

  const authorRegistration = await request(app)
    .post("/api/v1/auth/register")
    .send(author);

  expect([200, 201]).toContain(authorRegistration.status);
  authorId = authorRegistration.body.data.user.id;
  authorAccessToken = authorRegistration.body.data.accessToken;

  const otherUserRegistration = await request(app)
    .post("/api/v1/auth/register")
    .send(otherUser);

  expect([200, 201]).toContain(otherUserRegistration.status);
  otherUserId = otherUserRegistration.body.data.user.id;
  otherUserAccessToken = otherUserRegistration.body.data.accessToken;

  const postResponse = await request(app)
    .post("/api/v1/social/posts")
    .set("Authorization", `Bearer ${authorAccessToken}`)
    .send({ content: "Post deletion integration fixture." });

  expect(postResponse.status).toBe(201);
  postId = postResponse.body.data.post.id;
});

afterAll(async () => {
  try {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [authorId, otherUserId].filter(Boolean),
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe("Social post deletion integration API", () => {
  test("requires authentication", async () => {
    const response = await request(app).delete(
      `/api/v1/social/posts/${postId}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects malformed IDs and hides missing-post existence", async () => {
    const invalid = await request(app)
      .delete("/api/v1/social/posts/not-a-uuid")
      .set("Authorization", `Bearer ${authorAccessToken}`);
    const missing = await request(app)
      .delete(`/api/v1/social/posts/${MISSING_POST_ID}`)
      .set("Authorization", `Bearer ${authorAccessToken}`);

    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.error.code).toBe("POST_NOT_FOUND");
  });

  test("prevents another user from deleting the post", async () => {
    const liked = await request(app)
      .post(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${otherUserAccessToken}`);

    expect(liked.status).toBe(201);

    const deletion = await request(app)
      .delete(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${otherUserAccessToken}`);
    const missing = await request(app)
      .delete(`/api/v1/social/posts/${MISSING_POST_ID}`)
      .set("Authorization", `Bearer ${otherUserAccessToken}`);

    expect(deletion.status).toBe(404);
    expect(deletion.body.success).toBe(false);
    expect(deletion.body.error.code).toBe("POST_NOT_FOUND");
    expect(deletion.body).toEqual(missing.body);
    expect(
      await prisma.post.findUnique({ where: { id: postId } }),
    ).not.toBeNull();
    expect(await prisma.postLike.count({ where: { postId } })).toBe(1);
  });

  test("lets the author delete the post and cascades its likes", async () => {
    const deletion = await request(app)
      .delete(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${authorAccessToken}`);

    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({
      success: true,
      data: {
        postId,
        deleted: true,
      },
    });
    expect(await prisma.post.findUnique({ where: { id: postId } })).toBeNull();
    expect(await prisma.postLike.count({ where: { postId } })).toBe(0);

    const engagement = await request(app)
      .get(`/api/v1/social/posts/${postId}/engagement`)
      .set("Authorization", `Bearer ${otherUserAccessToken}`);

    expect(engagement.status).toBe(404);
    expect(engagement.body.error.code).toBe("POST_NOT_FOUND");

    const repeatedDeletion = await request(app)
      .delete(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${authorAccessToken}`);

    expect(repeatedDeletion.status).toBe(404);
    expect(repeatedDeletion.body.error.code).toBe("POST_NOT_FOUND");
  });
});
