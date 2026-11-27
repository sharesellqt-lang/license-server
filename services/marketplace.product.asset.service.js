
"use strict";

const db = require("../db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TextDecoder } = require("util");
const { uploadDir, allowedTypes } = require("../middleware/marketplace.product.upload");
const { writeAudit } = require("./contributor.audit.service");

const FILE_ROLES = [
    "thumbnail",
    "preview",
    "documentation",
    "delivery",
    "source",
    "other"
];

const THUMBNAIL_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024;

const EDITABLE_STATUSES = [
    "draft",
    "revision_required",
    "rejected"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_PRODUCT_ID");
    return id;
}

async function removeFile(filename) {
    if (!filename) return;

    const safeName = path.basename(filename);
    const baseDir = path.resolve(uploadDir);
    const filePath = path.resolve(baseDir, safeName);
    const relativePath = path.relative(baseDir, filePath);

    if (
        !relativePath ||
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath)
    ) {
        return;
    }

    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error(
                "MARKETPLACE FILE CLEANUP ERROR:",
                error.message
            );
        }
    }
}
async function validateThumbnail(file) {
    if (!file) fail("PRODUCT_FILE_REQUIRED");

    if (!THUMBNAIL_TYPES.includes(file.mimetype)) {
        fail("INVALID_PRODUCT_THUMBNAIL_TYPE");
    }

    if (!file.size || file.size > MAX_THUMBNAIL_SIZE) {
        fail("PRODUCT_THUMBNAIL_TOO_LARGE");
    }

    const valid = await validateSignature(file);

    if (!valid) fail("PRODUCT_FILE_SIGNATURE_INVALID");

    return true;
}

async function getSellerAndProduct(conn, userId, productId, lock = false) {
    const [sellers] = await conn.execute(
        `SELECT id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1
         ${lock ? "FOR UPDATE" : ""}`,
        [userId]
    );

    if (!sellers.length) fail("SELLER_NOT_FOUND");
    if (sellers[0].status !== "active") fail("SELLER_NOT_ACTIVE");

    const [products] = await conn.execute(
        `SELECT id, seller_id, status
         FROM marketplace_products
         WHERE id = ? AND seller_id = ?
         LIMIT 1
         ${lock ? "FOR UPDATE" : ""}`,
        [productId, sellers[0].id]
    );

    if (!products.length) fail("PRODUCT_NOT_FOUND");

    return {
        seller: sellers[0],
        product: products[0]
    };
}

async function attachProductFile(userId, productId, file, fileRole, audit = {}) {
    productId = validId(productId);

    if (!file) fail("PRODUCT_FILE_REQUIRED");
    if (!FILE_ROLES.includes(fileRole)) fail("INVALID_PRODUCT_FILE_ROLE");
    if (!allowedTypes[file.mimetype]) fail("INVALID_PRODUCT_FILE_TYPE");

    let conn;
    let committed = false;

    try {
        const valid = await validateSignature(file);

        if (!valid) fail("PRODUCT_FILE_SIGNATURE_INVALID");

        const hash = await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(file.path);
            const digest = crypto.createHash("sha256");

            stream.on("data", chunk => digest.update(chunk));
            stream.on("error", reject);
            stream.on("end", () => resolve(digest.digest("hex")));
        });

        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_FILES_NOT_EDITABLE");
        }

        const originalName = path.basename(
            String(file.originalname || "file")
        ).slice(0, 255);

        const [result] = await conn.execute(
            `INSERT INTO marketplace_product_files (
                product_id,
                file_role,
                original_name,
                storage_key,
                mime_type,
                file_size,
                file_hash,
                uploaded_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                productId,
                fileRole,
                originalName,
                file.filename,
                file.mimetype,
                file.size,
                hash,
                userId
            ]
        );

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.file_uploaded",
            entityType: "marketplace_product_file",
            entityId: String(result.insertId),
            newData: {
                productId,
                fileRole,
                originalName,
                fileSize: file.size,
                fileHash: hash
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        return {
            id: result.insertId,
            productId,
            fileRole,
            originalName,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileHash: hash
        };
    } catch (error) {
        if (conn && !committed) {
            try {
                await conn.rollback();
            } catch (_) {}
        }
        throw error;
    } finally {
        if (conn) conn.release();
        if (!committed) await removeFile(file.filename);
    }
}

async function replaceProductThumbnail(userId, productId, file, audit = {}) {
    productId = validId(productId);

    if (!file) fail("PRODUCT_FILE_REQUIRED");

    let conn;
    let committed = false;
    let oldStorageKeys = [];
    let result;

    try {
        await validateThumbnail(file);

        const hash = await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(file.path);
            const digest = crypto.createHash("sha256");

            stream.on("data", chunk => digest.update(chunk));
            stream.on("error", reject);
            stream.on("end", () => resolve(digest.digest("hex")));
        });

        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_FILES_NOT_EDITABLE");
        }

        const [oldFiles] = await conn.execute(
            `SELECT id, storage_key
             FROM marketplace_product_files
             WHERE product_id = ?
               AND file_role = 'thumbnail'
               AND is_active = 1
             ORDER BY id DESC
             FOR UPDATE`,
            [productId]
        );

        oldStorageKeys = oldFiles.map(item => item.storage_key);

        const originalName = path.basename(
            String(file.originalname || "thumbnail")
        ).slice(0, 255);

        const [insertResult] = await conn.execute(
            `INSERT INTO marketplace_product_files (
                product_id,
                file_role,
                original_name,
                storage_key,
                mime_type,
                file_size,
                file_hash,
                uploaded_by_user_id
            ) VALUES (?, 'thumbnail', ?, ?, ?, ?, ?, ?)`,
            [
                productId,
                originalName,
                file.filename,
                file.mimetype,
                file.size,
                hash,
                userId
            ]
        );

        if (oldFiles.length) {
            await conn.execute(
                `UPDATE marketplace_product_files
                 SET is_active = 0
                 WHERE product_id = ?
                   AND file_role = 'thumbnail'
                   AND is_active = 1
                   AND id <> ?`,
                [productId, insertResult.insertId]
            );
        }

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.thumbnail_replaced",
            entityType: "marketplace_product_file",
            entityId: String(insertResult.insertId),
            oldData: {
                thumbnailIds: oldFiles.map(item => item.id)
            },
            newData: {
                productId,
                fileRole: "thumbnail",
                originalName,
                mimeType: file.mimetype,
                fileSize: file.size,
                fileHash: hash
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        result = {
            id: insertResult.insertId,
            productId,
            fileRole: "thumbnail",
            originalName,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileHash: hash,
            thumbnailUrl: `/api/marketplace/products/${productId}/thumbnail`
        };

        // Chỉ dọn file cũ sau khi transaction đã commit.
        for (const storageKey of oldStorageKeys) {
            await removeFile(storageKey);
        }

        return result;
    } catch (error) {
        if (conn && !committed) {
            try {
                await conn.rollback();
            } catch (_) {}
        }

        throw error;
    } finally {
        if (conn) conn.release();

        if (!committed) {
            await removeFile(file.filename);
        }
    }
}
async function deleteProductThumbnail(userId, productId, audit = {}) {
    productId = validId(productId);

    let conn;
    let committed = false;
    let storageKeys = [];
    let deletedIds = [];

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_FILES_NOT_EDITABLE");
        }

        const [files] = await conn.execute(
            `SELECT id, storage_key
             FROM marketplace_product_files
             WHERE product_id = ?
               AND file_role = 'thumbnail'
               AND is_active = 1
             ORDER BY id DESC
             FOR UPDATE`,
            [productId]
        );

        if (!files.length) {
            fail("PRODUCT_THUMBNAIL_NOT_FOUND");
        }

        storageKeys = files.map(file => file.storage_key);
        deletedIds = files.map(file => file.id);

        await conn.execute(
            `UPDATE marketplace_product_files
             SET is_active = 0
             WHERE product_id = ?
               AND file_role = 'thumbnail'
               AND is_active = 1`,
            [productId]
        );

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.thumbnail_deleted",
            entityType: "marketplace_product_file",
            entityId: String(deletedIds[0]),
            oldData: {
                productId,
                thumbnailIds: deletedIds
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        for (const storageKey of storageKeys) {
            await removeFile(storageKey);
        }

        return {
            productId,
            deleted: true
        };
    } catch (error) {
        if (conn && !committed) {
            try {
                await conn.rollback();
            } catch (_) {}
        }

        throw error;
    } finally {
        if (conn) conn.release();
    }
}
async function getMyProductFiles(userId, productId) {
    productId = validId(productId);

    const conn = await db.getConnection();

    try {
        await getSellerAndProduct(conn, userId, productId);

        const [rows] = await conn.execute(
            `SELECT id, product_id, file_role, original_name,
                    mime_type, file_size, file_hash, version,
                    is_active, created_at
             FROM marketplace_product_files
             WHERE product_id = ?
             ORDER BY id DESC`,
            [productId]
        );

        return rows;
    } finally {
        conn.release();
    }
}

async function deleteProductFile(userId, productId, fileId, audit = {}) {
    productId = validId(productId);
    fileId = validId(fileId);

    let conn;
    let storageKey = null;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_FILES_NOT_EDITABLE");
        }

        const [files] = await conn.execute(
            `SELECT id, storage_key, file_role
             FROM marketplace_product_files
             WHERE id = ? AND product_id = ?
             LIMIT 1
             FOR UPDATE`,
            [fileId, productId]
        );

        if (!files.length) fail("PRODUCT_FILE_NOT_FOUND");

        const file = files[0];

        if (file.file_role === "thumbnail") {
            fail("USE_PRODUCT_THUMBNAIL_ENDPOINT");
        }

        // A demo cannot keep referencing a deleted file.
        const [demos] = await conn.execute(
            `SELECT id
             FROM marketplace_product_demos
             WHERE file_id = ?
             LIMIT 1`,
            [fileId]
        );

        if (demos.length) fail("PRODUCT_FILE_IN_USE_BY_DEMO");

        storageKey = file.storage_key;

        await conn.execute(
            `DELETE FROM marketplace_product_files
             WHERE id = ? AND product_id = ?`,
            [fileId, productId]
        );

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.file_deleted",
            entityType: "marketplace_product_file",
            entityId: String(fileId),
            oldData: {
                productId,
                fileRole: file.file_role
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();

        await removeFile(storageKey);

        return { id: fileId, deleted: true };
    } catch (error) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (_) {}
        }
        throw error;
    } finally {
        if (conn) conn.release();
    }
}


async function saveProductDemo(userId, productId, data, demoId = null, audit = {}) {
    productId = validId(productId);
    if (demoId !== null) demoId = validId(demoId);

    const isUpdate = demoId !== null;
    const type = String(data.demoType || "").trim();
    const allowedDemoTypes = ["image", "video", "url", "file"];

    if (!allowedDemoTypes.includes(type)) {
        fail("INVALID_DEMO_TYPE");
    }

    const title = String(data.title || "").trim();
    const description = String(data.description || "").trim();

    if (title.length > 255 || description.length > 10000) {
        fail("INVALID_DEMO_INFORMATION");
    }

    let demoUrl = null;
    let fileId = null;

    if (type === "url") {
        demoUrl = String(data.demoUrl || "").trim();

        if (!demoUrl || demoUrl.length > 5000) {
            fail("INVALID_DEMO_URL");
        }

        try {
            const parsed = new URL(demoUrl);

            if (!["http:", "https:"].includes(parsed.protocol)) {
                fail("INVALID_DEMO_URL");
            }
        } catch (error) {
            if (error.code === "INVALID_DEMO_URL") throw error;
            fail("INVALID_DEMO_URL");
        }
    } else {
        fileId = validId(data.fileId);
    }

    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_DEMOS_NOT_EDITABLE");
        }

        // Validate and lock the referenced file in the same transaction.
        if (fileId !== null) {
            const [files] = await conn.execute(
                `SELECT id, mime_type, file_role
                 FROM marketplace_product_files
                 WHERE id = ?
                   AND product_id = ?
                   AND is_active = 1
                 LIMIT 1
                 FOR UPDATE`,
                [fileId, productId]
            );

            if (!files.length) {
                fail("PRODUCT_FILE_NOT_FOUND");
            }

            const file = files[0];
            const mime = String(file.mime_type || "").toLowerCase();

            if (type === "image") {
                if (
                    !mime.startsWith("image/") ||
                    file.file_role !== "preview"
                ) {
                    fail("DEMO_FILE_TYPE_MISMATCH");
                }
            } else if (type === "video") {
                if (
                    !mime.startsWith("video/") ||
                    file.file_role !== "preview"
                ) {
                    fail("DEMO_FILE_TYPE_MISMATCH");
                }
            } else if (type === "file") {
                if (!["preview", "documentation"].includes(file.file_role)) {
                    fail("DEMO_FILE_TYPE_MISMATCH");
                }
            }
        }

        const sortOrder = Math.max(
            0,
            Math.min(100000, Number(data.sortOrder) || 0)
        );

        if (isUpdate) {
            const [existing] = await conn.execute(
                `SELECT id
                 FROM marketplace_product_demos
                 WHERE id = ? AND product_id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [demoId, productId]
            );

            if (!existing.length) {
                fail("PRODUCT_DEMO_NOT_FOUND");
            }

            await conn.execute(
                `UPDATE marketplace_product_demos
                 SET demo_type = ?,
                     title = ?,
                     description = ?,
                     demo_url = ?,
                     file_id = ?,
                     sort_order = ?
                 WHERE id = ? AND product_id = ?`,
                [
                    type,
                    title || null,
                    description || null,
                    demoUrl,
                    fileId,
                    sortOrder,
                    demoId,
                    productId
                ]
            );
        } else {
            const [result] = await conn.execute(
                `INSERT INTO marketplace_product_demos (
                    product_id,
                    demo_type,
                    title,
                    description,
                    demo_url,
                    file_id,
                    sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    productId,
                    type,
                    title || null,
                    description || null,
                    demoUrl,
                    fileId,
                    sortOrder
                ]
            );

            demoId = result.insertId;
        }

        await writeAudit(conn, {
            actorUserId: userId,
            action: isUpdate
                ? "marketplace.product.demo_updated"
                : "marketplace.product.demo_created",
            entityType: "marketplace_product_demo",
            entityId: String(demoId),
            newData: {
                productId,
                demoType: type,
                title,
                fileId,
                sortOrder
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();

        return {
            id: demoId,
            productId,
            demoType: type,
            title: title || null,
            description: description || null,
            demoUrl,
            fileId,
            sortOrder
        };
    } catch (error) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (_) {}
        }

        throw error;
    } finally {
        if (conn) conn.release();
    }
}


async function getMyProductDemos(userId, productId) {
    productId = validId(productId);

    const conn = await db.getConnection();

    try {
        await getSellerAndProduct(conn, userId, productId);

        const [rows] = await conn.execute(
            `SELECT d.id, d.product_id, d.demo_type, d.title,
                    d.description, d.demo_url, d.file_id,
                    d.sort_order, d.is_active, d.created_at,
                    f.original_name, f.mime_type, f.file_size
             FROM marketplace_product_demos d
             LEFT JOIN marketplace_product_files f
               ON f.id = d.file_id
             WHERE d.product_id = ?
             ORDER BY d.sort_order ASC, d.id ASC`,
            [productId]
        );

        return rows;
    } finally {
        conn.release();
    }
}

async function deleteProductDemo(userId, productId, demoId, audit = {}) {
    productId = validId(productId);
    demoId = validId(demoId);

    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const { product } = await getSellerAndProduct(
            conn,
            userId,
            productId,
            true
        );

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_DEMOS_NOT_EDITABLE");
        }

        const [result] = await conn.execute(
            `DELETE FROM marketplace_product_demos
             WHERE id = ? AND product_id = ?`,
            [demoId, productId]
        );

        if (!result.affectedRows) fail("PRODUCT_DEMO_NOT_FOUND");

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.demo_deleted",
            entityType: "marketplace_product_demo",
            entityId: String(demoId),
            oldData: { productId },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();

        return { id: demoId, deleted: true };
    } catch (error) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (_) {}
        }
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

module.exports = {
    attachProductFile,
    replaceProductThumbnail,
    deleteProductThumbnail,
    getMyProductFiles,
    deleteProductFile,
    saveProductDemo,
    getMyProductDemos,
    deleteProductDemo,
    removeFile
};