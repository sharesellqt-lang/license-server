const router = require("express").Router();
const ctrl = require("../controllers/profile.controller");
const auth = require("../middleware/auth");

router.get("/", auth, ctrl.getProfiles);

module.exports = router;