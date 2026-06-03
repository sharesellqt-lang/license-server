const router = require("express").Router();
const ctrl = require("../controllers/swipe.controller");
const auth = require("../middleware/auth");

// like / dislike
router.post("/", auth, ctrl.swipe);

router.post("/undo", auth, ctrl.undoSwipe);

// liked users
router.get("/likes", auth, ctrl.getLikedUsers);

router.get("/", auth, ctrl.getSwipes);

router.delete(
  "/dislike/:id",
  auth,
  ctrl.undoDislike
);

router.get(
  "/disliked",
  auth,
  ctrl.getDislikedUsers
);

// unlike
router.delete("/:id", auth, ctrl.unlikeUser);

module.exports = router;