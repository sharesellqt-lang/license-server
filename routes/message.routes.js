const router = require("express").Router();
const ctrl = require("../controllers/message.controller");
const auth = require("../middleware/auth");

router.post("/", auth, ctrl.sendMessage);
router.get("/:match_id", auth, ctrl.getMessages);

module.exports = router;