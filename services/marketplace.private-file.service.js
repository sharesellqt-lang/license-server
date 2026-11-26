"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");
const { uploadDir } = require("../middleware/marketplace.product.upload");

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_FILE_ID");
    return id;
}

function resolvePrivateFile(storageKey) {
    if (!storageKey || typeof storageKey !== "string") {
        fail("PRIVATE_FILE_NOT_FOUND");
    }

    const safeName = path.basename(storageKey);

    if (safeName !== storageKey) {
        fail("PRIVATE_FILE_NOT_FOUND");
    }

    const baseDir = path.resolve(uploadDir);
    const filePath = path.resolve(baseDir, safeName);

    if (!filePath.startsWith(baseDir + path.sep)) {
        fail("PRIVATE_FILE_NOT_FOUND");
    }

    return filePath;
}

// Seller: chỉ được truy cập file thuộc sản phẩm của chính mình.
async function getSellerProductFile(userId, productId, fileId) {
    userId = validId(userId);
    productId = validId(productId);
    fileId = validId(fileId);

    const [rows] = await db.execute(
        `SELECT f.id, f.original_name, f.storage_key,
                f.mime_type, f.file_size, f.file_role
         FROM marketplace_product_files f
         INNER JOIN marketplace_products p ON p.id = f.product_id
         INNER JOIN marketplace_sellers s ON s.id = p.seller_id
         WHERE s.user_id = ?
           AND s.status = 'active'
           AND p.id = ?
           AND f.id = ?
           AND f.is_active = 1
         LIMIT 1`,
        [userId, productId, fileId]
    );

    if (!rows.length) fail("PRIVATE_FILE_NOT_FOUND");

    return rows[0];
}

// Buyer: chỉ xem file preview được gắn với demo đang hoạt động
// của sản phẩm đã Published.
async function getPublicDemoFile(productId, demoId) {
    productId = validId(productId);
    demoId = validId(demoId);

    const [rows] = await db.execute(
        `SELECT f.id, f.original_name, f.storage_key,
                f.mime_type, f.file_size, f.file_role
         FROM marketplace_product_demos d
         INNER JOIN marketplace_products p ON p.id = d.product_id
         INNER JOIN marketplace_product_files f ON f.id = d.file_id
         WHERE d.id = ?
           AND d.product_id = ?
           AND d.is_active = 1
           AND d.file_id IS NOT NULL
           AND p.status = 'published'
           AND f.is_active = 1
           AND f.file_role = 'preview'
           AND d.demo_type IN ('image', 'file')
         LIMIT 1`,
        [demoId, productId]
    );

    if (!rows.length) fail("PRIVATE_FILE_NOT_FOUND");

    return rows[0];
}

// Buyer: chỉ tải file đã gắn với lần giao hàng của chính đơn hàng mình,
// đơn đã thanh toán và lần giao hàng đã được thực hiện.
async function getBuyerDeliveryFile(userId, deliveryId, fileId) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);
    fileId = validId(fileId);

    const [rows] = await db.execute(
        `SELECT f.id, f.original_name, f.storage_key,
                f.mime_type, f.file_size, f.file_role
         FROM marketplace_delivery_files df
         INNER JOIN marketplace_deliveries d ON d.id = df.delivery_id
         INNER JOIN marketplace_order_items oi ON oi.id = d.order_item_id
         INNER JOIN marketplace_orders o ON o.id = oi.order_id
         INNER JOIN marketplace_product_files f ON f.id = df.product_file_id
         WHERE o.buyer_user_id = ?
           AND o.payment_status = 'paid'
           AND o.order_status NOT IN ('cancelled', 'refunded', 'disputed')
           AND d.id = ?
           AND d.status IN ('delivered', 'confirmed')
           AND f.id = ?
           AND f.product_id = oi.product_id
           AND f.file_role = 'delivery'
           AND f.is_active = 1
         LIMIT 1`,
        [userId, deliveryId, fileId]
    );

    if (!rows.length) fail("PRIVATE_FILE_NOT_FOUND");

    return rows[0];
}


// Buyer: tải file thuộc một phiên bản giao hàng cụ thể.
async function getBuyerDeliveryVersionFile(userId, deliveryId, versionId, fileId) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);
    versionId = validId(versionId);
    fileId = validId(fileId);

    const [rows] = await db.execute(
        `SELECT vf.id, vf.original_name, vf.storage_key,
                vf.mime_type, vf.file_size
         FROM marketplace_delivery_version_files vf
         INNER JOIN marketplace_delivery_versions v
            ON v.id = vf.version_id
         INNER JOIN marketplace_deliveries d
            ON d.id = v.delivery_id
         INNER JOIN marketplace_order_items oi
            ON oi.id = d.order_item_id
         INNER JOIN marketplace_orders o
            ON o.id = oi.order_id
         WHERE o.buyer_user_id = ?
           AND o.payment_status = 'paid'
           AND o.order_status NOT IN ('cancelled', 'refunded', 'disputed')
           AND d.id = ?
           AND d.status IN ('delivered', 'confirmed')
           AND v.id = ?
           AND vf.id = ?
         LIMIT 1`,
        [userId, deliveryId, versionId, fileId]
    );

    if (!rows.length) fail("PRIVATE_FILE_NOT_FOUND");

    return rows[0];
}

async function sendPrivateFile(res, file, options = {}) {
    const filePath = resolvePrivateFile(file.storage_key);

    let stat;

    try {
        stat = await fs.promises.stat(filePath);
    } catch (error) {
        if (error.code === "ENOENT") fail("PRIVATE_FILE_NOT_FOUND");
        throw error;
    }

    if (!stat.isFile()) fail("PRIVATE_FILE_NOT_FOUND");

    const mimeType = String(file.mime_type || "application/octet-stream");
    const safeName = String(file.original_name || "download")
        .replace(/[\r\n"]/g, "_")
        .slice(0, 200);

    const disposition = options.download ? "attachment" : "inline";

    res.set({
        "Content-Type": mimeType,
        "Content-Length": stat.size,
        "Content-Disposition":
            `${disposition}; filename="${encodeURIComponent(safeName)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    });

    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);

        stream.on("error", reject);
        res.on("finish", resolve);
        res.on("close", () => {
            if (!res.writableFinished) {
                stream.destroy();
                resolve();
            }
        });

        stream.pipe(res);
    });
}

module.exports = {
    getSellerProductFile,
    getPublicDemoFile,
    getBuyerDeliveryFile,
    sendPrivateFile,
    getBuyerDeliveryVersionFile,
};