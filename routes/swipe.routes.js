const router = require("express").Router();
const ctrl = require("../controllers/swipe.controller");
const auth = require("../middleware/auth");

// like / dislike
router.post("/", auth, ctrl.swipe);

// liked users
router.get("/likes", auth, ctrl.getLikedUsers);

// unlike
router.delete("/:id", auth, ctrl.unlikeUser);

module.exports = router;