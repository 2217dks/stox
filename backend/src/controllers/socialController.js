const {
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  getFeed,
  createPost,
} = require("../services/socialService");

async function follow(req, res, next) {
  try {
    const { userId: targetUserId } = req.params;

    const follow = await followUser(req.user.userId, targetUserId);

    return res.status(201).json({
      success: true,
      data: {
        follow,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function unfollow(req, res, next) {
  try {
    const { userId: targetUserId } = req.params;

    const result = await unfollowUser(req.user.userId, targetUserId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getFollowers(req, res, next) {
  try {
    const followers = await listFollowers(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        followers,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getFollowing(req, res, next) {
  try {
    const following = await listFollowing(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        following,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listFeed(req, res, next) {
  try {
    const result = await getFeed(req.validatedQuery);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function addPost(req, res, next) {
  try {
    const post = await createPost(req.user.userId, req.body);

    return res.status(201).json({
      success: true,
      data: {
        post,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  follow,
  unfollow,
  getFollowers,
  getFollowing,
  listFeed,
  addPost,
};
