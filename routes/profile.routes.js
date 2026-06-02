const router = require("express").Router();
const ctrl = require("../controllers/profile.controller");
const auth = require("../middleware/auth");

// all profiles
router.get("/", auth, ctrl.getProfiles);

// my profile
router.get("/me", auth, ctrl.getMyProfile);

// create/update profile
router.post("/", auth, ctrl.saveProfile);

module.exports = router;