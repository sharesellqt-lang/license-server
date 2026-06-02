const router = require("express").Router();
const ctrl = require("../controllers/swipe.controller");
const auth = require("../middleware/auth");

router.post("/", auth, ctrl.swipe);

module.exports = router;