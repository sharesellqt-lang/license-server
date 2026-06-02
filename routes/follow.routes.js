const router = require("express").Router();
const ctrl = require("../controllers/follow.controller");
const auth = require("../middleware/auth.middleware");

router.post("/", auth.verifyUser, ctrl.follow);

module.exports = router;