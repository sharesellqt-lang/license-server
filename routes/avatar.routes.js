const router = require("express").Router();
const multer = require("multer");
const path = require("path");

const auth = require("../middleware/auth");

const storage = multer.diskStorage({

  destination(req, file, cb) {
    cb(null, "uploads/avatars");
  },

  filename(req, file, cb) {

    const ext =
      path.extname(file.originalname);

    cb(
      null,
      `avatar_${req.user.id}_${Date.now()}${ext}`
    );

  }

});

const upload =
  multer({ storage });

router.post(
  "/",
  auth,
  upload.single("avatar"),
  (req, res) => {

    res.json({

      success: true,

      url:
        `/uploads/avatars/${req.file.filename}`

    });

  }
);

module.exports = router;