const router = require("express").Router();
const ctrl = require("../controllers/match.controller");
const auth = require("../middleware/auth");

router.get("/", auth, ctrl.getMatches);

module.exports = router;