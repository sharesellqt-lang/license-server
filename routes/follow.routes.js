const router = require("express").Router();
const ctrl = require("../controllers/follow.controller");
const auth = require("../middleware/auth");

router.post("/", auth, ctrl.follow);

module.exports = router;

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