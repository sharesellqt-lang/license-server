const router = require("express").Router();
const ctrl = require("../controllers/social.controller");
const auth = require("../middleware/auth");

// ❤️ liked list
router.get("/likes", auth, ctrl.getLikedUsers);

// ➕ following list
router.get("/following", auth, ctrl.getFollowingUsers);

module.exports = router;