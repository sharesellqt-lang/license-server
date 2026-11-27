
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const PRODUCT_TYPES = [
    "template",
    "software",
    "utility",
    "design_resource",
    "digital_document",
    "course",
    "digital_service",
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

function cleanText(value, maxLength, field, required = false) {
    const text = value == null ? "" : String(value).trim();

    if (required && !text) fail(`INVALID_${field}`);
    if (text.length > maxLength) fail(`INVALID_${field}`);

    return text || null;
}

function normalizeSlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 260) || "product";
}

function normalizePrice(value) {
    const price = Number(value);

    if (!Number.isFinite(price) || price < 0 || price > 9999999999999.99) {
        fail("INVALID_PRODUCT_PRICE");
    }

    return price.toFixed(2);
}

function normalizeProductData(data, partial = false) {
    const result = {};

    const fields = {
        title: [255, true],
        short_description: [500, false],
        description: [100000, true],
        version: [50, false],
        requirements: [20000, false],
        compatibility: [20000, false],
        license_terms: [50000, false],
        documentation: [20000, false],
        support_policy: [20000, false],
        update_policy: [20000, false],
        refund_policy: [20000, false]
    };

    for (const [field, [max, required]] of Object.entries(fields)) {
        if (partial && data[field] === undefined) continue;

        result[field] = cleanText(
            data[field],
            max,
            field.toUpperCase(),
            required
        );

        if (required && !result[field]) {
            fail(`INVALID_${field.toUpperCase()}`);
        }
    }

    if (!partial || data.product_type !== undefined) {
        const type = String(data.product_type || "other");

        if (!PRODUCT_TYPES.includes(type)) {
            fail("INVALID_PRODUCT_TYPE");
        }

        result.product_type = type;
    }

    if (!partial || data.price !== undefined) {
        result.price = normalizePrice(data.price ?? 0);
    }

    if (!partial || data.currency !== undefined) {
        const currency = String(data.currency || "VND").trim().toUpperCase();

        if (currency !== "VND") fail("INVALID_PRODUCT_CURRENCY");

        result.currency = currency;
    }

    return result;
}
async function writeProductAudit(conn, actorUserId, action, productId, oldData, newData, audit = {}) {
    return writeAudit(conn, {
        actorUserId,
        action,
        entityType: "marketplace_product",
        entityId: String(productId),
        oldData,
        newData,
        ipAddress: audit.ipAddress || null,
        userAgent: audit.userAgent || null
    });
}

async function getActiveSeller(conn, userId, lock = false) {
    const [rows] = await conn.execute(
        `SELECT id, user_id, display_name, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1
         ${lock ? "FOR UPDATE" : ""}`,
        [userId]
    );

    if (!rows.length) fail("SELLER_NOT_FOUND");
    if (rows[0].status !== "active") fail("SELLER_NOT_ACTIVE");

    return rows[0];
}

async function getOwnedProduct(conn, productId, sellerId, lock = false) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM marketplace_products
         WHERE id = ? AND seller_id = ?
         LIMIT 1
         ${lock ? "FOR UPDATE" : ""}`,
        [productId, sellerId]
    );

    if (!rows.length) fail("PRODUCT_NOT_FOUND");

    return rows[0];
}

async function getProductDetail(conn, productId) {
    const [products] = await conn.execute(
        `SELECT p.*, s.display_name AS seller_name
         FROM marketplace_products p
         INNER JOIN marketplace_sellers s ON s.id = p.seller_id
         WHERE p.id = ?
         LIMIT 1`,
        [productId]
    );

    if (!products.length) fail("PRODUCT_NOT_FOUND");

    const product = products[0];

    const [files] = await conn.execute(
        `SELECT id, product_id, file_role, original_name,
                mime_type, file_size, file_hash, version,
                is_active, created_at
         FROM marketplace_product_files
         WHERE product_id = ?
         ORDER BY id DESC`,
        [productId]
    );

    const [demos] = await conn.execute(
        `SELECT d.id, d.demo_type, d.title, d.description,
                d.demo_url, d.file_id, d.sort_order,
                d.is_active, d.created_at
         FROM marketplace_product_demos d
         WHERE d.product_id = ?
         ORDER BY d.sort_order ASC, d.id ASC`,
        [productId]
    );

    const [reviews] = await conn.execute(
        `SELECT id, reviewer_user_id, decision, feedback,
                checklist, created_at
         FROM marketplace_product_reviews
         WHERE product_id = ?
         ORDER BY id DESC`,
        [productId]
    );

    return {
        ...product,
        files,
        demos,
        reviews
    };
}

// ========================================
// SELLER: CREATE PRODUCT
// ========================================

async function createProduct(userId, data, audit = {}) {
    const productData = normalizeProductData(data || {});
    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const seller = await getActiveSeller(conn, userId, true);

        const baseSlug = normalizeSlug(data.slug || productData.title);
        let slug = baseSlug;
        let suffix = 1;

        while (true) {
            const [existing] = await conn.execute(
                `SELECT id FROM marketplace_products
                 WHERE slug = ?
                 LIMIT 1`,
                [slug]
            );

            if (!existing.length) break;

            suffix++;
            slug = `${baseSlug}-${suffix}`;
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_products (
                seller_id, title, slug, short_description,
                description, product_type, price, currency,
                version, requirements, compatibility,
                license_terms, documentation, support_policy,
                update_policy, refund_policy, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
            [
                seller.id,
                productData.title,
                slug,
                productData.short_description,
                productData.description,
                productData.product_type,
                productData.price,
                productData.currency,
                productData.version,
                productData.requirements,
                productData.compatibility,
                productData.license_terms,
                productData.documentation,
                productData.support_policy,
                productData.update_policy,
                productData.refund_policy
            ]
        );

        await writeProductAudit(
            conn,
            userId,
            "marketplace.product.created",
            result.insertId,
            null,
            { title: productData.title, slug, status: "draft" },
            audit
        );

        await conn.commit();

        return {
            id: result.insertId,
            sellerId: seller.id,
            title: productData.title,
            slug,
            status: "draft"
        };

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// SELLER: LIST MY PRODUCTS
// ========================================



async function getMyProducts(userId, params = {}) {
    const conn = await db.getConnection();

    try {
        const seller = await getActiveSeller(conn, userId);

        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
        const offset = (page - 1) * limit;

        const conditions = ["p.seller_id = ?"];
        const values = [seller.id];

        if (params.status) {
            conditions.push("p.status = ?");
            values.push(String(params.status));
        }

        if (params.search) {
            const search = `%${String(params.search).trim()}%`;
            conditions.push("(p.title LIKE ? OR p.slug LIKE ?)");
            values.push(search, search);
        }

        const where = conditions.join(" AND ");

        const [countRows] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_products p
             WHERE ${where}`,
            values
        );

        const [rows] = await conn.execute(
            `SELECT
                p.id,
                p.title,
                p.slug,
                p.short_description,
                p.product_type,
                p.price,
                p.currency,
                p.version,
                p.status,
                p.review_note,
                p.published_at,
                p.created_at,
                p.updated_at,
                (
                    SELECT f.id
                    FROM marketplace_product_files f
                    WHERE f.product_id = p.id
                      AND f.file_role = 'thumbnail'
                      AND f.is_active = 1
                      AND f.mime_type IN (
                          'image/jpeg',
                          'image/png',
                          'image/webp'
                      )
                    ORDER BY f.id DESC
                    LIMIT 1
                ) AS thumbnail_file_id,
                (
                    SELECT f.mime_type
                    FROM marketplace_product_files f
                    WHERE f.product_id = p.id
                      AND f.file_role = 'thumbnail'
                      AND f.is_active = 1
                      AND f.mime_type IN (
                          'image/jpeg',
                          'image/png',
                          'image/webp'
                      )
                    ORDER BY f.id DESC
                    LIMIT 1
                ) AS thumbnail_mime_type
             FROM marketplace_products p
             WHERE ${where}
             ORDER BY p.updated_at DESC, p.id DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        const total = Number(countRows[0].total);

        return {
            items: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } finally {
        conn.release();
    }
}


// ========================================
// SELLER: GET MY PRODUCT DETAIL
// ========================================

async function getMyProductDetail(userId, productId) {
    const conn = await db.getConnection();

    try {
        const seller = await getActiveSeller(conn, userId);
        await getOwnedProduct(conn, productId, seller.id);

        return await getProductDetail(conn, productId);
    } finally {
        conn.release();
    }
}

// ========================================
// SELLER: UPDATE PRODUCT
// ========================================

async function updateProduct(userId, productId, data, audit = {}) {
    const productData = normalizeProductData(data || {}, true);
    const fields = Object.keys(productData);

    if (!fields.length) fail("NO_PRODUCT_FIELDS_TO_UPDATE");

    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const seller = await getActiveSeller(conn, userId, true);
        const product = await getOwnedProduct(conn, productId, seller.id, true);

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_NOT_EDITABLE");
        }

        const assignments = fields.map(field => `${field} = ?`).join(", ");
        const values = fields.map(field => productData[field]);

        await conn.execute(
            `UPDATE marketplace_products
             SET ${assignments}, updated_at = NOW()
             WHERE id = ?`,
            [...values, productId]
        );

        await writeProductAudit(
            conn,
            userId,
            "marketplace.product.updated",
            productId,
            { status: product.status },
            productData,
            audit
        );

        const updatedProduct = await getProductDetail(conn, productId);

        await conn.commit();

        return updatedProduct;

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// SELLER: SUBMIT FOR REVIEW
// ========================================

async function submitProduct(userId, productId, audit = {}) {
    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const seller = await getActiveSeller(conn, userId, true);
        const product = await getOwnedProduct(conn, productId, seller.id, true);

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_CANNOT_BE_SUBMITTED");
        }

        if (
            !product.title ||
            !product.description ||
            !PRODUCT_TYPES.includes(product.product_type)
        ) {
            fail("PRODUCT_INFORMATION_INCOMPLETE");
        }

        if (Number(product.price) < 0) {
            fail("INVALID_PRODUCT_PRICE");
        }

        await conn.execute(
            `UPDATE marketplace_products
             SET status = 'pending_review',
                 review_note = NULL,
                 reviewed_by = NULL,
                 reviewed_at = NULL,
                 updated_at = NOW()
             WHERE id = ?`,
            [productId]
        );

        await writeProductAudit(
            conn,
            userId,
            "marketplace.product.submitted",
            productId,
            { status: product.status },
            { status: "pending_review" },
            audit
        );

        await conn.commit();

        return {
            id: product.id,
            status: "pending_review"
        };

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// SELLER: ARCHIVE PRODUCT
// ========================================

async function archiveProduct(userId, productId, audit = {}) {
    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const seller = await getActiveSeller(conn, userId, true);
        const product = await getOwnedProduct(conn, productId, seller.id, true);

        if (!EDITABLE_STATUSES.includes(product.status)) {
            fail("PRODUCT_CANNOT_BE_ARCHIVED");
        }

        await conn.execute(
            `UPDATE marketplace_products
             SET status = 'archived', updated_at = NOW()
             WHERE id = ?`,
            [productId]
        );

        await writeProductAudit(
            conn,
            userId,
            "marketplace.product.archived",
            productId,
            { status: product.status },
            { status: "archived" },
            audit
        );

        await conn.commit();

        return { id: product.id, status: "archived" };

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// ADMIN: LIST PRODUCTS
// ========================================

async function getAdminProducts(params = {}) {
    const conn = await db.getConnection();

    try {
        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
        const offset = (page - 1) * limit;

        const conditions = ["1 = 1"];
        const values = [];

        if (params.status) {
            conditions.push("p.status = ?");
            values.push(String(params.status));
        }

        if (params.productType) {
            if (!PRODUCT_TYPES.includes(String(params.productType))) {
                fail("INVALID_PRODUCT_TYPE");
            }

            conditions.push("p.product_type = ?");
            values.push(String(params.productType));
        }

        if (params.sellerId) {
            conditions.push("p.seller_id = ?");
            values.push(Number(params.sellerId));
        }

        if (params.search) {
            conditions.push(
                "(p.title LIKE ? OR p.slug LIKE ? OR s.display_name LIKE ?)"
            );

            const search = `%${String(params.search).trim()}%`;
            values.push(search, search, search);
        }

        const where = conditions.join(" AND ");

        const [countRows] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_products p
             INNER JOIN marketplace_sellers s ON s.id = p.seller_id
             WHERE ${where}`,
            values
        );

        const [rows] = await conn.execute(
            `SELECT p.id, p.seller_id, s.display_name AS seller_name,
                    p.title, p.slug, p.product_type, p.price,
                    p.currency, p.status, p.reviewed_by,
                    p.reviewed_at, p.review_note,
                    p.created_at, p.updated_at
             FROM marketplace_products p
             INNER JOIN marketplace_sellers s ON s.id = p.seller_id
             WHERE ${where}
             ORDER BY
               CASE p.status
                 WHEN 'pending_review' THEN 1
                 WHEN 'under_review' THEN 2
                 ELSE 3
               END,
               p.created_at ASC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return {
            items: rows,
            pagination: {
                page,
                limit,
                total: Number(countRows[0].total),
                totalPages: Math.ceil(Number(countRows[0].total) / limit)
            }
        };
    } finally {
        conn.release();
    }
}

// ========================================
// ADMIN: GET PRODUCT DETAIL
// ========================================

async function getAdminProductDetail(productId) {
    const conn = await db.getConnection();

    try {
        return await getProductDetail(conn, productId);
    } finally {
        conn.release();
    }
}

// ========================================
// ADMIN: MODERATE PRODUCT
// decision: approved / rejected / revision_required / suspended
// ========================================

async function moderateProduct(
    productId,
    actorUserId,
    decision,
    feedback,
    checklist,
    audit = {}
) {
    const allowedDecisions = [
        "approved",
        "rejected",
        "revision_required",
        "suspended"
    ];

    if (!allowedDecisions.includes(decision)) {
        fail("INVALID_PRODUCT_DECISION");
    }

    const note = cleanText(feedback, 10000, "REVIEW_FEEDBACK");
    let checklistJson = null;

    if (checklist !== undefined && checklist !== null) {
        try {
            checklistJson = JSON.stringify(checklist);
        } catch (_) {
            fail("INVALID_REVIEW_CHECKLIST");
        }

        if (checklistJson.length > 50000) {
            fail("INVALID_REVIEW_CHECKLIST");
        }
    }

    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT *
             FROM marketplace_products
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [productId]
        );

        if (!rows.length) fail("PRODUCT_NOT_FOUND");

        const product = rows[0];

        if (product.status === "archived") {
            fail("PRODUCT_ALREADY_ARCHIVED");
        }

        if (
            decision !== "suspended" &&
            !["pending_review", "under_review", "approved"].includes(product.status)
        ) {
            fail("PRODUCT_NOT_IN_REVIEW");
        }

        if (
            decision === "suspended" &&
            !["published", "approved", "pending_review", "under_review"].includes(product.status)
        ) {
            fail("PRODUCT_CANNOT_BE_SUSPENDED");
        }

        const nextStatus = decision;

        await conn.execute(
            `UPDATE marketplace_products
             SET status = ?,
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 review_note = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [nextStatus, actorUserId, note, productId]
        );

        await conn.execute(
            `INSERT INTO marketplace_product_reviews (
                product_id, reviewer_user_id, decision,
                feedback, checklist
             ) VALUES (?, ?, ?, ?, ?)`,
            [
                productId,
                actorUserId,
                decision,
                note,
                checklistJson
            ]
        );

        await writeProductAudit(
            conn,
            actorUserId,
            `marketplace.product.${decision}`,
            productId,
            { status: product.status },
            { status: nextStatus, feedback: note },
            audit
        );

        await conn.commit();

        return {
            id: Number(productId),
            previousStatus: product.status,
            status: nextStatus,
            decision
        };

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// ADMIN: PUBLISH APPROVED PRODUCT
// ========================================

async function publishProduct(productId, actorUserId, audit = {}) {
    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT id, status, published_at
             FROM marketplace_products
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [productId]
        );

        if (!rows.length) fail("PRODUCT_NOT_FOUND");

        const product = rows[0];

        if (product.status !== "approved") {
            fail("PRODUCT_NOT_APPROVED");
        }

        await conn.execute(
            `UPDATE marketplace_products
             SET status = 'published',
                 published_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [productId]
        );

        await writeProductAudit(
            conn,
            actorUserId,
            "marketplace.product.published",
            productId,
            { status: product.status },
            { status: "published" },
            audit
        );

        await conn.commit();

        return {
            id: Number(productId),
            status: "published"
        };

    } catch (error) {
        if (conn) await conn.rollback();
        throw error;
    } finally {
        if (conn) conn.release();
    }
}

module.exports = {
    createProduct,
    getMyProducts,
    getMyProductDetail,
    updateProduct,
    submitProduct,
    archiveProduct,
    getAdminProducts,
    getAdminProductDetail,
    moderateProduct,
    publishProduct
};
