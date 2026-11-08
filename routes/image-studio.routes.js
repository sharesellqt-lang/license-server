
const express = require("express");
const multer = require("multer");
const router = express.Router();

const auth = require("../middleware/auth");
const controller = require("../controllers/image-studio.controller");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype));
    }
});

// AI CONFIG
router.get("/config", auth, controller.getConfig);

// AI IMAGE-TO-IMAGE
router.post("/edit", auth, upload.single("image"), controller.edit);

module.exports = router;
