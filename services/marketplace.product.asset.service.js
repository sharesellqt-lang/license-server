
"use strict";

const db = require("../db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TextDecoder } = require("util");

const {
    uploadDir,
    allowedTypes
} = require("../middleware/marketplace.product.upload");

const storageService = require("./marketplace.storage.service");
const scannerService = require("./marketplace.scanner.service");
const { writeAudit } = require("./contributor.audit.service");

const FILE_ROLES = [
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
    "rejected",
    "paused"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        fail("INVALID_PRODUCT_ID");
    }

    return id;
}

function getOriginalName(file, fallback = "file") {
    return path.basename(
        String(file?.originalname || fallback)
    ).slice(0, 255);
}

function getStorageKey(file) {
    const filename = String(file?.filename || "");

    // Multer hiện tạo UUID + extension, không cho phép path.
    if (
        !filename ||
        path.basename(filename) !== filename ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("\0")
    ) {
        fail("INVALID_PRODUCT_STORAGE_FILENAME");
    }

    return `products/${filename}`;
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
                "MARKETPLACE TEMP FILE CLEANUP ERROR:",
                error.message
            );
        }
    }
}

async function cleanupStorageObject(storageKey) {
    if (!storageKey) return;

    try {
        await storageService.deleteObject(storageKey);
    } catch (error) {
        console.error(
            "MARKETPLACE STORAGE CLEANUP ERROR:",
            storageKey,
            error.message
        );
    }
}

async function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        const digest = crypto.createHash("sha256");

        stream.on("data", chunk => digest.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(digest.digest("hex")));
    });
}

async function uploadProductObject(file, storageKey, hash) {
    if (!file?.path || !file.size) {
        fail("PRODUCT_FILE_REQUIRED");
    }

    await storageService.uploadObject({
        key: storageKey,
        body: fs.createReadStream(file.path),
        contentType: file.mimetype || "application/octet-stream",
        contentLength: file.size,
        metadata: {
            sha256: hash
        }
    });

    return {
        storageKey,
        fileHash: hash
    };
}

async function validateSignature(file) {
    if (!file?.path || !file?.mimetype || !file.size) {
        return false;
    }

    const signatures = {
        "image/jpeg": {
            bytes: [0xFF, 0xD8, 0xFF],
            offset: 0
        },
        "image/png": {
            bytes: [
                0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
            ],
            offset: 0
        },
        "application/pdf": {
            bytes: [0x25, 0x50, 0x44, 0x46, 0x2D],
            offset: 0
        },
        "application/zip": {
            bytes: [0x50, 0x4B, 0x03, 0x04],
            offset: 0
        },
        "application/x-zip-compressed": {
            bytes: [0x50, 0x4B, 0x03, 0x04],
            offset: 0
        },
        "video/mp4": {
            bytes: [0x66, 0x74, 0x79, 0x70],
            offset: 4
        }
    };

    try {
        if (file.mimetype === "image/webp") {
            const handle = await fs.promises.open(file.path, "r");

            try {
                const buffer = Buffer.alloc(12);
                const { bytesRead } = await handle.read(
                    buffer,
                    0,
                    12,
                    0
                );

                return bytesRead === 12 &&
                    buffer.toString("ascii", 0, 4) === "RIFF" &&
                    buffer.toString("ascii", 8, 12) === "WEBP";
            } finally {
                await handle.close();
            }
        }

        if (file.mimetype === "text/plain") {
            const decoder = new TextDecoder("utf-8", {
                fatal: true
            });

            const stream = fs.createReadStream(file.path);

            try {
                for await (const chunk of stream) {
                    if (chunk.includes(0)) return false;
                    decoder.decode(chunk, { stream: true });
                }

                decoder.decode();
                return true;
            } catch (_) {
                return false;
            }
        }

        const signature = signatures[file.mimetype];

        if (!signature) return false;

        const handle = await fs.promises.open(file.path, "r");

        try {
            const buffer = Buffer.alloc(
                signature.offset + signature.bytes.length
            );

            const { bytesRead } = await handle.read(
                buffer,
                0,
                buffer.length,
                0
            );

            if (bytesRead < buffer.length) return false;

            return signature.bytes.every(
                (byte, index) =>
                    buffer[signature.offset + index] === byte
            );
        } finally {
            await handle.close();
        }
    } catch (error) {
        console.error(
            "MARKETPLACE FILE SIGNATURE ERROR:",
            error.message
        );

        return false;
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

    if (!valid) {
        fail("PRODUCT_FILE_SIGNATURE_INVALID");
    }

    return true;
}

async function getSellerAndProduct(
    conn,
    userId,
    productId,
    lock = false
) {
    const [sellers] = await conn.execute(
        `SELECT id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1
         ${lock ? "FOR UPDATE" : ""}`,
        [userId]
    );

    if (!sellers.length) fail("SELLER_NOT_FOUND");
    if (sellers[0].status !== "active") {
        fail("SELLER_NOT_ACTIVE");
    }

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

async function insertFileAndScan(
    conn,
    {
        productId,
        fileRole,
        originalName,
        storageKey,
        mimeType,
        fileSize,
        fileHash,
        userId
    }
) {
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
            storageKey,
            mimeType,
            fileSize,
            fileHash,
            userId
        ]
    );

    // Scan record + job phải nằm trong cùng transaction
    // với metadata của file.
    await scannerService.enqueueScan(
        conn,
        storageKey,
        1
    );

    return result;
}

async function attachProductFile(
    userId,
    productId,
    file,
    fileRole,
    audit = {}
) {
    productId = validId(productId);

    if (!file) fail("PRODUCT_FILE_REQUIRED");
    if (!FILE_ROLES.includes(fileRole)) {
        fail("INVALID_PRODUCT_FILE_ROLE");
    }
    if (!allowedTypes[file.mimetype]) {
        fail("INVALID_PRODUCT_FILE_TYPE");
    }

    let conn;
    let committed = false;
    let storageKey = null;
    let uploadAttempted = false;

    try {
        const valid = await validateSignature(file);

        if (!valid) {
            fail("PRODUCT_FILE_SIGNATURE_INVALID");
        }

        const hash = await hashFile(file.path);
        storageKey = getStorageKey(file);

        // Upload object trước khi tạo metadata.
        // Nếu DB transaction thất bại sẽ xóa object này.
        uploadAttempted = true;

        await uploadProductObject(
            file,
            storageKey,
            hash
        );

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

        const originalName = getOriginalName(file);

        const result = await insertFileAndScan(conn, {
            productId,
            fileRole,
            originalName,
            storageKey,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileHash: hash,
            userId
        });

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
                fileHash: hash,
                scanStatus: "pending"
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
            fileHash: hash,
            scanStatus: "pending"
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

        if (uploadAttempted && !committed) {
            await cleanupStorageObject(storageKey);
        }

        await removeFile(file?.filename);
    }
}

async function replaceProductThumbnail(
    userId,
    productId,
    file,
    audit = {}
) {
    productId = validId(productId);

    if (!file) fail("PRODUCT_FILE_REQUIRED");

    let conn;
    let committed = false;
    let storageKey = null;
    let uploadAttempted = false;

    try {
        await validateThumbnail(file);

        const hash = await hashFile(file.path);
        storageKey = getStorageKey(file);

        uploadAttempted = true;

        await uploadProductObject(
            file,
            storageKey,
            hash
        );

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
            `SELECT id
             FROM marketplace_product_files
             WHERE product_id = ?
               AND file_role = 'thumbnail'
               AND is_active = 1
             ORDER BY id DESC
             FOR UPDATE`,
            [productId]
        );

        const originalName = getOriginalName(
            file,
            "thumbnail"
        );

        const insertResult = await insertFileAndScan(conn, {
            productId,
            fileRole: "thumbnail",
            originalName,
            storageKey,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileHash: hash,
            userId
        });

        await conn.execute(
            `UPDATE marketplace_product_files
             SET is_active = 0
             WHERE product_id = ?
               AND file_role = 'thumbnail'
               AND is_active = 1
               AND id <> ?`,
            [productId, insertResult.insertId]
        );

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
                fileHash: hash,
                scanStatus: "pending"
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        return {
            id: insertResult.insertId,
            productId,
            fileRole: "thumbnail",
            originalName,
            mimeType: file.mimetype,
            fileSize: file.size,
            fileHash: hash,
            scanStatus: "pending",
            thumbnailUrl: `/api/marketplace/products/${productId}/thumbnail`
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

        if (uploadAttempted && !committed) {
            await cleanupStorageObject(storageKey);
        }

        await removeFile(file?.filename);
    }
}

async function deleteProductThumbnail(
    userId,
    productId,
    audit = {}
) {
    productId = validId(productId);

    let conn;
    let committed = false;
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
            `SELECT id
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

        // Không xóa object vật lý:
        // thumbnail có thể đang được delivery/version tham chiếu.
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
        await getSellerAndProduct(
            conn,
            userId,
            productId
        );

        const [rows] = await conn.execute(
            `SELECT
                f.id,
                f.product_id,
                f.file_role,
                f.original_name,
                f.mime_type,
                f.file_size,
                f.file_hash,
                f.version,
                f.is_active,
                f.created_at,
                COALESCE(s.scan_status, 'pending') AS scan_status,
                s.scanned_at,
                s.scan_engine,
                s.scan_signature_version,
                s.last_error_code
             FROM marketplace_product_files f
             LEFT JOIN marketplace_file_scans s
               ON s.storage_key = f.storage_key
             WHERE f.product_id = ?
             ORDER BY f.id DESC`,
            [productId]
        );

        return rows;
    } finally {
        conn.release();
    }
}

async function deleteProductFile(
    userId,
    productId,
    fileId,
    audit = {}
) {
    productId = validId(productId);
    fileId = validId(fileId);

    let conn;
    let committed = false;

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
            `SELECT id, storage_key, file_role, is_active
             FROM marketplace_product_files
             WHERE id = ?
               AND product_id = ?
             LIMIT 1
             FOR UPDATE`,
            [fileId, productId]
        );

        if (!files.length) {
            fail("PRODUCT_FILE_NOT_FOUND");
        }

        const file = files[0];

        if (file.file_role === "thumbnail") {
            fail("USE_PRODUCT_THUMBNAIL_ENDPOINT");
        }

        if (!file.is_active) {
            fail("PRODUCT_FILE_ALREADY_INACTIVE");
        }

        const [demos] = await conn.execute(
            `SELECT id
             FROM marketplace_product_demos
             WHERE file_id = ?
             LIMIT 1
             FOR UPDATE`,
            [fileId]
        );

        if (demos.length) {
            fail("PRODUCT_FILE_IN_USE_BY_DEMO");
        }

        const [deliveries] = await conn.execute(
            `SELECT id
             FROM marketplace_delivery_files
             WHERE product_file_id = ?
             LIMIT 1
             FOR UPDATE`,
            [fileId]
        );

        if (deliveries.length) {
            fail("PRODUCT_FILE_IN_USE_BY_DELIVERY");
        }

        const [versions] = await conn.execute(
            `SELECT id
             FROM marketplace_delivery_version_files
             WHERE storage_key = ?
             LIMIT 1
             FOR UPDATE`,
            [file.storage_key]
        );

        if (versions.length) {
            fail("PRODUCT_FILE_IN_USE_BY_DELIVERY");
        }

        // Soft deactivate để giữ lịch sử và tránh xóa nhầm object.
        await conn.execute(
            `UPDATE marketplace_product_files
             SET is_active = 0
             WHERE id = ?
               AND product_id = ?`,
            [fileId, productId]
        );

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.file_deleted",
            entityType: "marketplace_product_file",
            entityId: String(fileId),
            oldData: {
                productId,
                fileRole: file.file_role,
                storageKey: file.storage_key
            },
            newData: {
                isActive: false
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        return {
            id: fileId,
            deleted: true,
            storageRetained: true
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

async function saveProductDemo(
    userId,
    productId,
    data,
    demoId = null,
    audit = {}
) {
    productId = validId(productId);

    if (demoId !== null) {
        demoId = validId(demoId);
    }

    const isUpdate = demoId !== null;
    const type = String(data.demoType || "").trim();
    const allowedDemoTypes = [
        "image",
        "video",
        "url",
        "file"
    ];

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
            if (error.code === "INVALID_DEMO_URL") {
                throw error;
            }

            fail("INVALID_DEMO_URL");
        }
    } else {
        fileId = validId(data.fileId);
    }

    let conn;
    let committed = false;

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

        if (fileId !== null) {
            const [files] = await conn.execute(
                `SELECT
                    f.id,
                    f.mime_type,
                    f.file_role,
                    s.scan_status
                 FROM marketplace_product_files f
                 LEFT JOIN marketplace_file_scans s
                   ON s.storage_key = f.storage_key
                 WHERE f.id = ?
                   AND f.product_id = ?
                   AND f.is_active = 1
                 LIMIT 1
                 FOR UPDATE`,
                [fileId, productId]
            );

            if (!files.length) {
                fail("PRODUCT_FILE_NOT_FOUND");
            }

            const file = files[0];

            // Fail closed: không có scan record cũng không được dùng.
            if (file.scan_status !== "clean") {
                fail("PRODUCT_FILE_NOT_SCANNED_CLEAN");
            }

            const mime = String(
                file.mime_type || ""
            ).toLowerCase();

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
                if (
                    !["preview", "documentation"].includes(
                        file.file_role
                    )
                ) {
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
                 WHERE id = ?
                   AND product_id = ?
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
                 WHERE id = ?
                   AND product_id = ?`,
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
        committed = true;

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

async function getMyProductDemos(userId, productId) {
    productId = validId(productId);

    const conn = await db.getConnection();

    try {
        await getSellerAndProduct(
            conn,
            userId,
            productId
        );

        const [rows] = await conn.execute(
            `SELECT
                d.id,
                d.product_id,
                d.demo_type,
                d.title,
                d.description,
                d.demo_url,
                d.file_id,
                d.sort_order,
                d.is_active,
                d.created_at,
                f.original_name,
                f.mime_type,
                f.file_size,
                COALESCE(s.scan_status, 'pending') AS scan_status
             FROM marketplace_product_demos d
             LEFT JOIN marketplace_product_files f
               ON f.id = d.file_id
             LEFT JOIN marketplace_file_scans s
               ON s.storage_key = f.storage_key
             WHERE d.product_id = ?
             ORDER BY d.sort_order ASC, d.id ASC`,
            [productId]
        );

        return rows;
    } finally {
        conn.release();
    }
}

async function deleteProductDemo(
    userId,
    productId,
    demoId,
    audit = {}
) {
    productId = validId(productId);
    demoId = validId(demoId);

    let conn;
    let committed = false;

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
             WHERE id = ?
               AND product_id = ?`,
            [demoId, productId]
        );

        if (!result.affectedRows) {
            fail("PRODUCT_DEMO_NOT_FOUND");
        }

        await writeAudit(conn, {
            actorUserId: userId,
            action: "marketplace.product.demo_deleted",
            entityType: "marketplace_product_demo",
            entityId: String(demoId),
            oldData: {
                productId
            },
            ipAddress: audit.ipAddress || null,
            userAgent: audit.userAgent || null
        });

        await conn.commit();
        committed = true;

        return {
            id: demoId,
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
