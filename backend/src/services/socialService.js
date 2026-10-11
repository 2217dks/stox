const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

// Only non-sensitive public profile fields are ever exposed by the social API.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
};

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

function serializePost(post) {
  return {
    id: post.id,
    authorId: post.authorId,
    author: post.author ?? null,
    content: post.content,
    symbol: post.symbol,
    metadata: post.metadata,
    isHidden: post.isHidden,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

async function followUser(userId, targetUserId) {
  await ensureActiveUser(userId);

  if (userId === targetUserId) {
    throw AppError.badRequest(
      "You cannot follow yourself.",
      "CANNOT_FOLLOW_SELF",
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!target) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  try {
    const follow = await prisma.follow.create({
      data: {
        followerId: userId,
        followingId: targetUserId,
      },
    });

    return {
      followerId: follow.followerId,
      followingId: follow.followingId,
      createdAt: follow.createdAt,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      throw AppError.conflict(
        "You already follow this user.",
        "ALREADY_FOLLOWING",
      );
    }

    throw error;
  }
}

async function unfollowUser(userId, targetUserId) {
  await ensureActiveUser(userId);

  const result = await prisma.follow.deleteMany({
    where: {
      followerId: userId,
      followingId: targetUserId,
    },
  });

  if (result.count === 0) {
    throw AppError.notFound("You do not follow this user.", "NOT_FOLLOWING");
  }

  return { followingId: targetUserId, unfollowed: true };
}

async function listFollowers(userId) {
  await ensureActiveUser(userId);

  const follows = await prisma.follow.findMany({
    where: {
      followingId: userId,
    },
    include: {
      follower: {
        select: PUBLIC_USER_SELECT,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return follows.map((follow) => ({
    ...follow.follower,
    followedAt: follow.createdAt,
  }));
}

async function listFollowing(userId) {
  await ensureActiveUser(userId);

  const follows = await prisma.follow.findMany({
    where: {
      followerId: userId,
    },
    include: {
      following: {
        select: PUBLIC_USER_SELECT,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return follows.map((follow) => ({
    ...follow.following,
    followedAt: follow.createdAt,
  }));
}

async function getFeed({ page = 1, limit = 20 } = {}) {
  const where = { isHidden: false };

  const skip = (page - 1) * limit;

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      include: {
        author: {
          select: PUBLIC_USER_SELECT,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.post.count({
      where,
    }),
  ]);

  return {
    posts: posts.map(serializePost),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function createPost(userId, { content, symbol, metadata }) {
  await ensureActiveUser(userId);

  const post = await prisma.post.create({
    data: {
      authorId: userId,
      content,
      symbol: symbol ?? null,
      metadata: metadata ?? null,
    },
    include: {
      author: {
        select: PUBLIC_USER_SELECT,
      },
    },
  });

  return serializePost(post);
}

module.exports = {
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  getFeed,
  createPost,
};
