const router = require("express").Router();

const auth = require("../middleware/auth");
const multer = require("multer");
const path = require("path");

// =========================
// STORAGE CONFIG
// =========================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/avatars");
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + "_" + Math.round(Math.random() * 1e9);
    cb(null, "avatar_" + unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// =========================
// UPLOAD ROUTE
// =========================
router.post(
  "/avatar",
  auth,
  upload.single("avatar"),
  (req, res) => {
    res.json({
      url: "/uploads/avatars/" + req.file.filename
    });
  }
);

module.exports = router;