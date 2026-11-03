const router = require("express").Router();
const auth = require("../middleware/auth");
const multer = require("multer");
const { Readable } = require("stream");
const cloudinary = require("../config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận JPG, PNG hoặc WEBP."));
    }
    cb(null, true);
  }
});

function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "datinghub-avatars",
        resource_type: "image"
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(file.buffer).pipe(stream);
  });
}

router.post("/", auth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Vui lòng chọn ảnh đại diện."
      });
    }

    const result = await uploadToCloudinary(req.file);

    return res.json({
      url: result.secure_url
    });
  } catch (error) {
    console.error("AVATAR UPLOAD ERROR:", error.message);

    return res.status(500).json({
      success: false,
      error: "Không thể tải ảnh đại diện lên."
    });
  }
});

module.exports = router;