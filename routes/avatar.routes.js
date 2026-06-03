const router = require("express").Router();
const auth = require("../middleware/auth");

const multer = require("multer");

const cloudinary =
  require("../config/cloudinary");

const {
  CloudinaryStorage
} = require("multer-storage-cloudinary");

const storage =
  new CloudinaryStorage({
    cloudinary,
    params: {
      folder: "datinghub-avatars",
      allowed_formats: [
        "jpg",
        "jpeg",
        "png",
        "webp"
      ]
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
      url: req.file.path
    });

  }
);

module.exports = router;