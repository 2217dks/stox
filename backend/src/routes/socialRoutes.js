const express = require("express");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");

const {
  followParamsSchema,
  postIdParamsSchema,
  postParamsSchema,
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

router.get(
  "/posts/:postId",
  authMiddleware,
  validate(postParamsSchema, "params"),
  socialController.getPost,
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
