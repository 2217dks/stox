const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");

const {
  followParamsSchema,
  postIdParamsSchema,
  socialProfileParamsSchema,
  feedQuerySchema,
  createPostSchema,
} = require("../validators/socialValidator");

const socialController = require("../controllers/socialController");

const router = express.Router();

router.get(
  "/feed",
  authMiddleware,
  validate(feedQuerySchema, "query", "validatedQuery"),
  socialController.listFeed,
);

router.get(
  "/users/:userId",
  authMiddleware,
  validate(socialProfileParamsSchema, "params"),
  validate(feedQuerySchema, "query", "validatedQuery"),
  socialController.getProfile,
);

router.get(
  "/posts/:postId",
  authMiddleware,
  validate(postIdParamsSchema, "params"),
  socialController.getPostDetail,
);

router.post(
  "/posts",
  authMiddleware,
  validate(createPostSchema),
  socialController.addPost,
);

router.delete(
  "/posts/:postId",
  authMiddleware,
  validate(postIdParamsSchema, "params"),
  socialController.deletePost,
);

router.get(
  "/posts/:postId/engagement",
  authMiddleware,
  validate(postIdParamsSchema, "params"),
  socialController.getPostEngagement,
);

router.post(
  "/posts/:postId/likes",
  authMiddleware,
  validate(postIdParamsSchema, "params"),
  socialController.likePost,
);

router.delete(
  "/posts/:postId/likes",
  authMiddleware,
  validate(postIdParamsSchema, "params"),
  socialController.unlikePost,
);

router.get("/followers", authMiddleware, socialController.getFollowers);

router.get("/following", authMiddleware, socialController.getFollowing);

router.post(
  "/follow/:userId",
  authMiddleware,
  validate(followParamsSchema, "params"),
  socialController.follow,
);

router.delete(
  "/follow/:userId",
  authMiddleware,
  validate(followParamsSchema, "params"),
  socialController.unfollow,
);

module.exports = router;
