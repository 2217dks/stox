const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const firstUser = {
  name: "Post Engagement Author",
  email: `post-engagement-author-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const secondUser = {
  name: "Post Engagement Viewer",
  email: `post-engagement-viewer-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const MISSING_POST_ID = "00000000-0000-4000-8000-000000000099";

let authorId;
let viewerId;
let authorAccessToken;
let viewerAccessToken;
let postId;
let hiddenPostId;

beforeAll(async () => {
  jest.setTimeout(15000);

  const authorRegistration = await request(app)
    .post("/api/v1/auth/register")
    .send(firstUser);

  expect([200, 201]).toContain(authorRegistration.status);
  authorId = authorRegistration.body.data.user.id;
  authorAccessToken = authorRegistration.body.data.accessToken;

  const viewerRegistration = await request(app)
    .post("/api/v1/auth/register")
    .send(secondUser);

  expect([200, 201]).toContain(viewerRegistration.status);
  viewerId = viewerRegistration.body.data.user.id;
  viewerAccessToken = viewerRegistration.body.data.accessToken;

  const postResponse = await request(app)
    .post("/api/v1/social/posts")
    .set("Authorization", `Bearer ${authorAccessToken}`)
    .send({ content: "Post engagement integration fixture." });

  expect(postResponse.status).toBe(201);
  postId = postResponse.body.data.post.id;

  const hiddenPost = await prisma.post.create({
    data: {
      authorId,
      content: "Hidden engagement fixture.",
      isHidden: true,
    },
  });

  hiddenPostId = hiddenPost.id;
});

afterAll(async () => {
  try {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [authorId, viewerId].filter(Boolean),
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe("Post engagement integration API", () => {
  test("requires authentication to read or change engagement", async () => {
    const read = await request(app).get(
      `/api/v1/social/posts/${postId}/engagement`,
    );
    const like = await request(app).post(
      `/api/v1/social/posts/${postId}/likes`,
    );

    expect(read.status).toBe(401);
    expect(read.body.error.code).toBe("UNAUTHORIZED");
    expect(like.status).toBe(401);
    expect(like.body.error.code).toBe("UNAUTHORIZED");
  });

  test("starts with zero likes and an unliked viewer state", async () => {
    const response = await request(app)
      .get(`/api/v1/social/posts/${postId}/engagement`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.engagement).toEqual({
      postId,
      likesCount: 0,
      likedByViewer: false,
    });
  });

  test("creates a like and reports the updated count and viewer state", async () => {
    const response = await request(app)
      .post(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.engagement).toEqual({
      postId,
      likesCount: 1,
      likedByViewer: true,
    });
  });

  test("rejects duplicate likes without duplicating the record", async () => {
    const duplicate = await request(app)
      .post(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_LIKED");

    const records = await prisma.postLike.count({
      where: { postId, userId: viewerId },
    });
    const engagement = await request(app)
      .get(`/api/v1/social/posts/${postId}/engagement`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(records).toBe(1);
    expect(engagement.body.data.engagement.likesCount).toBe(1);
    expect(engagement.body.data.engagement.likedByViewer).toBe(true);
  });

  test("does not let another user remove the viewer's like", async () => {
    const response = await request(app)
      .delete(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${authorAccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("POST_NOT_LIKED");

    const count = await prisma.postLike.count({ where: { postId } });
    expect(count).toBe(1);
  });

  test("removes a like and rejects repeated removal", async () => {
    const removed = await request(app)
      .delete(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(removed.status).toBe(200);
    expect(removed.body.data.engagement).toEqual({
      postId,
      likesCount: 0,
      likedByViewer: false,
    });

    const repeated = await request(app)
      .delete(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(repeated.status).toBe(404);
    expect(repeated.body.error.code).toBe("POST_NOT_LIKED");
  });

  test("rejects malformed and missing post IDs", async () => {
    const invalid = await request(app)
      .get("/api/v1/social/posts/not-a-uuid/engagement")
      .set("Authorization", `Bearer ${viewerAccessToken}`);
    const missing = await request(app)
      .post(`/api/v1/social/posts/${MISSING_POST_ID}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("POST_NOT_FOUND");
  });

  test("does not expose hidden posts to engagement endpoints", async () => {
    const response = await request(app)
      .post(`/api/v1/social/posts/${hiddenPostId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("POST_NOT_FOUND");
  });

  test("post deletion cascades likes and makes engagement unavailable", async () => {
    const liked = await request(app)
      .post(`/api/v1/social/posts/${postId}/likes`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(liked.status).toBe(201);

    await prisma.post.delete({ where: { id: postId } });

    const likeCount = await prisma.postLike.count({ where: { postId } });
    const engagement = await request(app)
      .get(`/api/v1/social/posts/${postId}/engagement`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);

    expect(likeCount).toBe(0);
    expect(engagement.status).toBe(404);
    expect(engagement.body.error.code).toBe("POST_NOT_FOUND");
  });
});
