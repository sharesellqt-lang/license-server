
"use strict";

const fs = require("fs");
const path = require("path");
const { uploadDir } = require("../middleware/marketplace.receipt.upload");

const MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf"
};

async function sendReceiptFile(res, storageKey) {
    if (!storageKey || typeof storageKey !== "string") {
        return res.status(404).json({
            success: false,
            message: "Không tìm thấy biên lai."
        });
    }

    const filename = path.basename(storageKey);

    if (
        filename !== storageKey ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/i.test(filename)
    ) {
        return res.status(404).json({
            success: false,
            message: "Đường dẫn biên lai không hợp lệ."
        });
    }

    const baseDir = path.resolve(uploadDir);
    const filePath = path.resolve(baseDir, filename);
    const relativePath = path.relative(baseDir, filePath);

    if (
        !relativePath ||
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath)
    ) {
        return res.status(403).json({
            success: false,
            message: "Không có quyền truy cập file."
        });
    }

    try {
        const stat = await fs.promises.stat(filePath);

        if (!stat.isFile()) {
            throw new Error("Not a file");
        }

        const ext = path.extname(filename).toLowerCase();

        res.setHeader("Content-Type", MIME_TYPES[ext]);
        res.setHeader("Content-Length", stat.size);
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.setHeader("Pragma", "no-cache");

        const stream = fs.createReadStream(filePath);

        stream.on("error", err => {
            console.error("MARKETPLACE RECEIPT READ ERROR:", err);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Không thể đọc biên lai."
                });
            } else {
                res.destroy(err);
            }
        });

        stream.pipe(res);
    } catch (err) {
        if (err.code === "ENOENT") {
            return res.status(404).json({
                success: false,
                message: "File biên lai không còn tồn tại."
            });
        }

        console.error("MARKETPLACE RECEIPT ACCESS ERROR:", err);

        return res.status(500).json({
            success: false,
            message: "Không thể truy cập biên lai."
        });
    }
}

module.exports = { sendReceiptFile };
