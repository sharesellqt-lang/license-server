const router = require("express").Router();
const ctrl = require("../controllers/match.controller");
const auth = require("../middleware/auth.middleware");

router.get("/", auth.verifyUser, ctrl.getMatches);

module.exports = router;