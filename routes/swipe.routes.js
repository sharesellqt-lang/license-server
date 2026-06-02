const router = require("express").Router();
const ctrl = require("../controllers/swipe.controller");
const auth = require("../middleware/auth");

router.post("/", auth.verifyUser, ctrl.swipe);

module.exports = router;