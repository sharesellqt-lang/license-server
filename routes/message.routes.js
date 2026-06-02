const router = require("express").Router();
const ctrl = require("../controllers/message.controller");
const auth = require("../middleware/auth.middleware");

router.post("/", auth.verifyUser, ctrl.sendMessage);
router.get("/:match_id", auth.verifyUser, ctrl.getMessages);

module.exports = router;