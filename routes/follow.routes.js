const router = require("express").Router();
const ctrl = require("../controllers/follow.controller");
const auth = require("../middleware/auth");

router.post("/", auth, ctrl.follow);

// phải đặt trước /:user_id
router.get(
  "/following",
  auth,
  ctrl.getFollowingUsers
);

router.get(
  "/:user_id",
  auth,
  ctrl.getFollowers
);

router.delete(
  "/:id",
  auth,
  ctrl.unfollowUser
);

module.exports = router;