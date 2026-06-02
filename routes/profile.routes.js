const router = require("express").Router();
const ctrl = require("../controllers/profile.controller");
const auth = require("../middleware/auth.middleware");

router.get("/", auth.verifyUser, ctrl.getProfiles);

module.exports = router;