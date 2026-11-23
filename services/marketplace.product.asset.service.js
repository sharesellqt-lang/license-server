
"use strict";

const db = require("../db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { uploadDir, allowedTypes } = require("../middleware/marketplace.product.upload");
const { writeAudit } = require("./contributor.audit.service");

const FILE_ROLES = [
    "preview",
    "documentation",
    "delivery",
    "source",
    "other"
];

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
    const filePath = path.resolve(uploadDir, safeName);

    if (!filePath.startsWith(uploadDir + path.sep)) return;

    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("MARKETPLACE FILE CLEANUP ERROR:", error.message);
        }
    }
}

async function validateSignature(file) {
    const handle = await fs.promises.open(file.path, "r");

    try {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await handle.read(buffer, 0, 16, 0);
        const data = buffer.subarray(0, bytesRead);

        switch (file.mimetype) {
            case "image/jpeg":
                return data.length >= 3 &&
                    data[0] === 0xff &&
                    data[1] === 0xd8 &&
                    data[2] === 0xff;

            case "image/png":
                return data.length >= 8 &&
                    data.subarray(0, 8).equals(
                        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
                    );

            case "image/webp":
                return data.length >= 12 &&
                    data.toString("ascii", 0, 4) === "RIFF" &&
                    data.toString("ascii", 8, 12) === "WEBP";

            case "application/pdf":
                return data.toString("ascii", 0, 5) === "%PDF-";

            case "application/zip":
            case "application/x-zip-compressed":
                return data.length >= 4 &&
                    data[0] === 0x50 &&
                    data[1] === 0x4b &&
                    [0x03, 0x05, 0x07].includes(data[2]) &&
                    [0x04, 0x06, 0x08].includes(data[3]);

            case "video/mp4":
                return data.length >= 12 &&
                    data.toString("ascii", 4, 8) === "ftyp";

            default:
                return false;
        }
    } finally {
        await handle.close();
    }
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

    const type = String(data.demoType || "");
    const allowedTypes = ["image", "video", "url", "file"];

    if (!allowedTypes.includes(type)) fail("INVALID_DEMO_TYPE");

    const title = String(data.title || "").trim();
    const description = String(data.description || "").trim();

    if (title.length > 255 || description.length > 10000) {
        fail("INVALID_DEMO_INFORMATION");
    }

    let demoUrl = null;
    let fileId = null;

    if (type === "url") {
        demoUrl = String(data.demoUrl || "").trim();

        let parsed;
        try {
            parsed = new URL(demoUrl);
        } catch (_) {
            fail("INVALID_DEMO_URL");
        }

        if (!["http:", "https:"].includes(parsed.protocol)) {
            fail("INVALID_DEMO_URL");
        }

        if (demoUrl.length > 5000) fail("INVALID_DEMO_URL");
    } else {
        fileId = validId(data.fileId);

        if (type === "image" || type === "video") {
            const connCheck = await db.getConnection();
            try {
                const [files] = await connCheck.execute(
                    `SELECT id, mime_type, file_role
                     FROM marketplace_product_files
                     WHERE id = ? AND product_id = ?
                       AND is_active = 1
                     LIMIT 1`,
                    [fileId, productId]
                );

                if (!files.length) fail("PRODUCT_FILE_NOT_FOUND");

                const mime = files[0].mime_type || "";

                if (type === "image" && !mime.startsWith("image/")) {
                    fail("DEMO_FILE_TYPE_MISMATCH");
                }

                if (type === "video" && !mime.startsWith("video/")) {
                    fail("DEMO_FILE_TYPE_MISMATCH");
                }
            } finally {
                connCheck.release();
            }
        }
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

        const sortOrder = Math.max(
            0,
            Math.min(100000, Number(data.sortOrder) || 0)
        );

        if (demoId) {
            const [existing] = await conn.execute(
                `SELECT id
                 FROM marketplace_product_demos
                 WHERE id = ? AND product_id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [demoId, productId]
            );

            if (!existing.length) fail("PRODUCT_DEMO_NOT_FOUND");

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
                    product_id, demo_type, title, description,
                    demo_url, file_id, sort_order
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
            action: demoId ? "marketplace.product.demo_saved" : "marketplace.product.demo_created",
            entityType: "marketplace_product_demo",
            entityId: String(demoId),
            newData: {
                productId,
                demoType: type,
                title,
                fileId
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
    getMyProductFiles,
    deleteProductFile,
    saveProductDemo,
    deleteProductDemo,
    removeFile
};
