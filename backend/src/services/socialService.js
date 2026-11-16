const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

// Only non-sensitive public profile fields are ever exposed by the social API.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
};

const POST_SELECT = {
  id: true,
  authorId: true,
  content: true,
  symbol: true,
  metadata: true,
  isHidden: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: PUBLIC_USER_SELECT,
  },
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

async function getFeed(query = {}, viewerIdArg = null) {
  const {
    page = 1,
    limit = 20,
    sort = "latest",
    asOf,
    viewerId: viewerIdInQuery,
  } = query;

  const viewerId = viewerIdArg || viewerIdInQuery || null;

  const baseWhere = {
    isHidden: false,
    author: {
      isSuspended: false,
    },
  };

  if (sort === "trending") {
    const referenceTime = asOf ? new Date(asOf) : new Date();
    const sevenDaysAgo = new Date(
      referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000,
    );

    const candidates = await prisma.post.findMany({
      where: {
        ...baseWhere,
        createdAt: {
          gte: sevenDaysAgo,
          lte: referenceTime,
        },
      },
      select: {
        ...POST_SELECT,
        _count: {
          select: {
            likes: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    });

    let followingSet = new Set();

    if (viewerId && candidates.length > 0) {
      const authorIds = [...new Set(candidates.map((post) => post.authorId))];

      const follows = await prisma.follow.findMany({
        where: {
          followerId: viewerId,
          followingId: {
            in: authorIds,
          },
        },
        select: {
          followingId: true,
        },
      });

      followingSet = new Set(follows.map((follow) => follow.followingId));
    }

    const scored = candidates.map((post) => {
      const likes = post._count?.likes ?? 0;
      const isFollowing = viewerId ? followingSet.has(post.authorId) : false;
      const postTime = new Date(post.createdAt).getTime();
      const ageMs = Math.max(0, referenceTime.getTime() - postTime);
      const ageHours = ageMs / (1000 * 60 * 60);

      const numerator = likes + 1 + (isFollowing ? 2 : 0);
      const denominator = Math.pow(ageHours + 2, 1.2);
      const score = numerator / denominator;

      return {
        post,
        score,
      };
    });

    scored.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const timeDiff =
        new Date(right.post.createdAt).getTime() -
        new Date(left.post.createdAt).getTime();

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.post.id.localeCompare(right.post.id);
    });

    const total = scored.length;
    const start = (page - 1) * limit;
    const paged = scored.slice(start, start + limit);

    return {
      posts: paged.map((item) => serializePost(item.post)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  const skip = (page - 1) * limit;

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: baseWhere,
      select: POST_SELECT,
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.post.count({
      where: baseWhere,
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

async function getPublicProfile(userId, viewerId = null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...PUBLIC_USER_SELECT,
      _count: {
        select: {
          followers: true,
          following: true,
          posts: {
            where: {
              isHidden: false,
            },
          },
        },
      },
      ...(viewerId
        ? {
            followers: {
              where: {
                followerId: viewerId,
              },
              select: {
                id: true,
              },
              take: 1,
            },
          }
        : {}),
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    counts: {
      followers: user._count.followers,
      following: user._count.following,
      posts: user._count.posts,
    },
    isFollowing: viewerId ? user.followers.length > 0 : null,
  };
}

async function getPostById(postId) {
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      isHidden: false,
    },
    select: POST_SELECT,
  });

  if (!post) {
    throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
  }

  return serializePost(post);
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

async function deletePost(userId, postId) {
  await ensureActiveUser(userId);

  const result = await prisma.post.deleteMany({
    where: {
      id: postId,
      authorId: userId,
    },
  });

  if (result.count === 0) {
    throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
  }

  return {
    postId,
    deleted: true,
  };
}

function serializePostEngagement(postId, likesCount, likedByViewer) {
  return {
    postId,
    likesCount,
    likedByViewer,
  };
}

async function getPostEngagement(userId, postId) {
  await ensureActiveUser(userId);

  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      isHidden: false,
    },
    select: {
      id: true,
      _count: {
        select: {
          likes: true,
        },
      },
      likes: {
        where: {
          userId,
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!post) {
    throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
  }

  return serializePostEngagement(
    post.id,
    post._count.likes,
    post.likes.length > 0,
  );
}

async function likePost(userId, postId) {
  await ensureActiveUser(userId);

  try {
    return await prisma.$transaction(async (transaction) => {
      const post = await transaction.post.findFirst({
        where: {
          id: postId,
          isHidden: false,
        },
        select: {
          id: true,
        },
      });

      if (!post) {
        throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
      }

      await transaction.postLike.create({
        data: {
          postId,
          userId,
        },
      });

      const likesCount = await transaction.postLike.count({
        where: { postId },
      });

      return serializePostEngagement(postId, likesCount, true);
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw AppError.conflict("You already liked this post.", "ALREADY_LIKED");
    }

    if (error?.code === "P2003") {
      throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
    }

    throw error;
  }
}

async function unlikePost(userId, postId) {
  await ensureActiveUser(userId);

  return prisma.$transaction(async (transaction) => {
    const post = await transaction.post.findFirst({
      where: {
        id: postId,
        isHidden: false,
      },
      select: {
        id: true,
      },
    });

    if (!post) {
      throw AppError.notFound("Post not found.", "POST_NOT_FOUND");
    }

    const result = await transaction.postLike.deleteMany({
      where: {
        postId,
        userId,
      },
    });

    if (result.count === 0) {
      throw AppError.notFound(
        "You have not liked this post.",
        "POST_NOT_LIKED",
      );
    }

    const likesCount = await transaction.postLike.count({
      where: { postId },
    });

    return serializePostEngagement(postId, likesCount, false);
  });
}

module.exports = {
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  getFeed,
  getPublicProfile,
  createPost,
  deletePost,
  getPostEngagement,
  likePost,
  unlikePost,
  getPostById,
};