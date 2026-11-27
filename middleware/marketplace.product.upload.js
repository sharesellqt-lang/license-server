
"use strict";

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.resolve(__dirname, "../private_uploads/marketplace/products");

fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "video/mp4": ".mp4",
    "text/plain": ".txt"
};

const THUMBNAIL_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, uploadDir);
    },

    filename(req, file, cb) {
        const ext = allowedTypes[file.mimetype];

        if (!ext) {
            return cb(new Error("INVALID_PRODUCT_FILE_TYPE"));
        }

        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

// Upload file sản phẩm thông thường.
const fileFilter = (req, file, cb) => {
    if (!allowedTypes[file.mimetype]) {
        return cb(new Error("INVALID_PRODUCT_FILE_TYPE"));
    }

    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024,
        files: 1
    }
});

// Upload ảnh thumbnail riêng.
const thumbnailUpload = multer({
    storage,
    fileFilter(req, file, cb) {
        if (!THUMBNAIL_TYPES.includes(file.mimetype)) {
            return cb(new Error("INVALID_PRODUCT_THUMBNAIL_TYPE"));
        }

        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    }
});

module.exports = {
    upload,
    thumbnailUpload,
    uploadDir,
    allowedTypes
};
