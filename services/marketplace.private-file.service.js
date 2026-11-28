"use strict";

const db = require("../db");
const storageService = require("./marketplace.storage.service");
const { pipeline } = require("stream/promises");

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value, code = "INVALID_FILE_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail(code);
    return id;
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

async function getPublicProductThumbnail(productId) {
   productId = validId(productId, "INVALID_PRODUCT_ID");

    const [rows] = await db.execute(
        `SELECT
            f.id,
            f.original_name,
            f.storage_key,
            f.mime_type,
            f.file_size,
            f.file_role
         FROM marketplace_product_files f
         INNER JOIN marketplace_products p
            ON p.id = f.product_id
         INNER JOIN marketplace_sellers s
            ON s.id = p.seller_id
         WHERE p.id = ?
           AND p.status = 'published'
           AND s.status = 'active'
           AND f.file_role = 'thumbnail'
           AND f.is_active = 1
           AND f.mime_type IN (
               'image/jpeg',
               'image/png',
               'image/webp'
           )
         ORDER BY f.id DESC
         LIMIT 1`,
        [productId]
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
     INNER JOIN marketplace_products p
        ON p.id = d.product_id
     INNER JOIN marketplace_sellers s
        ON s.id = p.seller_id
     INNER JOIN marketplace_product_files f
        ON f.id = d.file_id
     WHERE d.id = ?
       AND d.product_id = ?
       AND d.is_active = 1
       AND d.file_id IS NOT NULL
       AND p.status = 'published'
       AND s.status = 'active'
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


// Seller: tải file thuộc lần bàn giao hiện tại của sản phẩm mình.
async function getSellerDeliveryFile(userId, deliveryId, fileId) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);
    fileId = validId(fileId);

    const [rows] = await db.execute(
        `SELECT
            f.id,
            f.original_name,
            f.storage_key,
            f.mime_type,
            f.file_size,
            f.file_role
         FROM marketplace_delivery_files df
         INNER JOIN marketplace_deliveries d
            ON d.id = df.delivery_id
         INNER JOIN marketplace_order_items oi
            ON oi.id = d.order_item_id
         INNER JOIN marketplace_product_files f
            ON f.id = df.product_file_id
         WHERE oi.seller_user_id = ?
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

// Seller: tải file thuộc một phiên bản bàn giao cụ thể.
async function getSellerDeliveryVersionFile(
    userId,
    deliveryId,
    versionId,
    fileId
) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);
    versionId = validId(versionId);
    fileId = validId(fileId);

    const [rows] = await db.execute(
        `SELECT
            vf.id,
            vf.original_name,
            vf.storage_key,
            vf.mime_type,
            vf.file_size
         FROM marketplace_delivery_version_files vf
         INNER JOIN marketplace_delivery_versions v
            ON v.id = vf.version_id
         INNER JOIN marketplace_deliveries d
            ON d.id = v.delivery_id
         INNER JOIN marketplace_order_items oi
            ON oi.id = d.order_item_id
         WHERE oi.seller_user_id = ?
           AND d.id = ?
           AND v.id = ?
           AND vf.id = ?
         LIMIT 1`,
        [userId, deliveryId, versionId, fileId]
    );

    if (!rows.length) fail("PRIVATE_FILE_NOT_FOUND");

    return rows[0];
}


async function sendPrivateFile(res, file, options = {}) {
    if (!file || !file.storage_key) {
        fail("PRIVATE_FILE_NOT_FOUND");
    }

    let object;

    try {
        object = await storageService.getObjectStream(file.storage_key);
    } catch (error) {
        if (
            error.code === "ENOENT" ||
            error.code === "NoSuchKey" ||
            error.code === "NotFound" ||
            error.name === "NoSuchKey" ||
            error.$metadata?.httpStatusCode === 404
        ) {
            fail("PRIVATE_FILE_NOT_FOUND");
        }

        throw error;
    }

    if (!object || !object.body) {
        fail("PRIVATE_FILE_NOT_FOUND");
    }

    const mimeType = String(
        file.mime_type || object.contentType || "application/octet-stream"
    );

    const safeName = String(file.original_name || "download")
        .replace(/[\r\n"]/g, "_")
        .slice(0, 200);

    const disposition = options.download ? "attachment" : "inline";

    const headers = {
        "Content-Type": mimeType,
        "Content-Disposition":
            `${disposition}; filename="${encodeURIComponent(safeName)}"`,
        "X-Content-Type-Options": "nosniff"
    };

    const contentLength = Number(
        object.contentLength ?? file.file_size
    );

    if (Number.isSafeInteger(contentLength) && contentLength >= 0) {
        headers["Content-Length"] = contentLength;
    }

    if (options.publicCache === true) {
        headers["Cache-Control"] =
            "public, max-age=300, stale-while-revalidate=3600";
    } else {
        headers["Cache-Control"] =
            "private, no-store, no-cache, must-revalidate";
        headers["Pragma"] = "no-cache";
        headers["Expires"] = "0";
    }

    res.set(headers);

    try {
        await pipeline(object.body, res);
    } catch (error) {
        if (res.destroyed || res.writableEnded) {
            return;
        }

        if (res.headersSent) {
            res.destroy(error);
            return;
        }

        throw error;
    }
}


module.exports = {
    getSellerProductFile,
    getPublicDemoFile,
    getPublicProductThumbnail,
    getBuyerDeliveryFile,
    getBuyerDeliveryVersionFile,
    getSellerDeliveryFile,
    getSellerDeliveryVersionFile,
    sendPrivateFile
};