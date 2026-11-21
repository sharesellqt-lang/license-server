
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const PRODUCT_STATUSES = ["draft", "active", "inactive"];
const SOURCE_TYPES = ["manual", "import", "api"];

function positiveId(value, error = "INVALID_PRODUCT_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(error);
    return id;
}

function validText(value, max, error, required = false) {
    const text = String(value ?? "").trim();

    if (required && !text) throw new Error(error);
    if (text.length > max) throw new Error(error);

    return text;
}

function validPrice(value) {
    if (value === "" || value == null) return 0;

    const price = Number(value);
    if (!Number.isFinite(price) || price < 0 || price > 9999999999999.99) {
        throw new Error("INVALID_PRODUCT_PRICE");
    }

    return price;
}

function validCurrency(value) {
    const currency = String(value || "VND").trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error("INVALID_PRODUCT_CURRENCY");
    }

    return currency;
}

function validUrl(value, error, required = false) {
    const url = String(value ?? "").trim();

    if (!url && !required) return null;

    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new Error();
        }
    } catch {
        throw new Error(error);
    }

    return url;
}

function pagination(query = {}) {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    if (!Number.isSafeInteger(page) || page < 1) {
        throw new Error("INVALID_PAGE");
    }

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("INVALID_LIMIT");
    }

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function normalizeProductInput(data = {}) {
    const product = {
        productId: validText(data.productId, 100, "INVALID_EXTERNAL_PRODUCT_ID", true),
        skuId: validText(data.skuId, 100, "INVALID_EXTERNAL_SKU_ID"),
        title: validText(data.title, 500, "INVALID_PRODUCT_TITLE", true),
        shortDescription: validText(
            data.shortDescription,
            5000,
            "INVALID_PRODUCT_DESCRIPTION"
        ),
        price: validPrice(data.price),
        currency: validCurrency(data.currency),
        imageUrl: validUrl(data.imageUrl, "INVALID_PRODUCT_IMAGE_URL"),
        affiliateLink: validUrl(
            data.affiliateLink,
            "INVALID_AFFILIATE_LINK",
            true
        ),
        finalUrl: validUrl(data.finalUrl, "INVALID_FINAL_URL")
    };

    return product;
}

async function resolveNetwork(conn, value) {
    let rows;

    if (Number.isSafeInteger(Number(value)) && Number(value) > 0) {
        [rows] = await conn.execute(
            `SELECT id, code, name, status
             FROM affiliate_networks
             WHERE id = ?
             LIMIT 1`,
            [Number(value)]
        );
    } else {
        const code = validText(value, 50, "INVALID_AFFILIATE_NETWORK", true)
            .toLowerCase();

        [rows] = await conn.execute(
            `SELECT id, code, name, status
             FROM affiliate_networks
             WHERE code = ?
             LIMIT 1`,
            [code]
        );
    }

    if (!rows.length) throw new Error("AFFILIATE_NETWORK_NOT_FOUND");
    if (rows[0].status !== "active") {
        throw new Error("AFFILIATE_NETWORK_INACTIVE");
    }

    return rows[0];
}

async function validateCategory(conn, categoryId) {
    if (categoryId == null || categoryId === "") return null;

    const id = positiveId(categoryId, "INVALID_CATEGORY_ID");

    const [rows] = await conn.execute(
        `SELECT id, status
         FROM affiliate_categories
         WHERE id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) throw new Error("AFFILIATE_CATEGORY_NOT_FOUND");
    if (rows[0].status !== "active") {
        throw new Error("AFFILIATE_CATEGORY_INACTIVE");
    }

    return id;
}

function auditInfo(actorUserId, audit = {}) {
    return {
        actorUserId: positiveId(actorUserId, "INVALID_USER_ID"),
        ipAddress: audit.ipAddress || null,
        userAgent: audit.userAgent || null
    };
}

// =========================
// PRODUCT CATALOG
// =========================

async function getProducts(query = {}, options = {}) {
    const { page, limit, offset } = pagination(query);
    const includeInactive = options.includeInactive === true;

    const conditions = [];
    const params = [];

    if (!includeInactive) {
        conditions.push("p.status = 'active'");
    } else if (query.status) {
        if (!PRODUCT_STATUSES.includes(query.status)) {
            throw new Error("INVALID_PRODUCT_STATUS");
        }

        conditions.push("p.status = ?");
        params.push(query.status);
    }

    if (query.network_id) {
        conditions.push("p.network_id = ?");
        params.push(positiveId(query.network_id, "INVALID_AFFILIATE_NETWORK_ID"));
    }

    if (query.category_id) {
        conditions.push("p.category_id = ?");
        params.push(positiveId(query.category_id, "INVALID_CATEGORY_ID"));
    }

    if (query.search) {
        const search = validText(query.search, 255, "INVALID_SEARCH");
        if (search) {
            conditions.push(`(
                p.title LIKE ?
                OR p.product_id LIKE ?
                OR p.sku_id LIKE ?
            )`);

            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword);
        }
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM affiliate_products p
         ${where}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.network_id,
            n.code AS network_code,
            n.name AS network_name,
            p.category_id,
            c.name AS category_name,
            p.product_id,
            p.sku_id,
            p.title,
            p.short_description,
            p.price,
            p.currency,
            p.image_url,
            p.affiliate_link,
            p.source_type,
            p.status,
            p.last_synced_at,
            p.created_at,
            p.updated_at
         FROM affiliate_products p
         INNER JOIN affiliate_networks n ON n.id = p.network_id
         LEFT JOIN affiliate_categories c ON c.id = p.category_id
         ${where}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const total = Number(count.total || 0);

    return {
        products: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getAdminProducts(query = {}) {
    return getProducts(query, { includeInactive: true });
}

async function getProductDetail(productId, options = {}) {
    const id = positiveId(productId);
    const conditions = ["p.id = ?"];

    if (options.includeInactive !== true) {
        conditions.push("p.status = 'active'");
    }

    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.network_id,
            n.code AS network_code,
            n.name AS network_name,
            n.status AS network_status,
            p.category_id,
            c.name AS category_name,
            p.product_id,
            p.sku_id,
            p.title,
            p.short_description,
            p.price,
            p.currency,
            p.image_url,
            p.affiliate_link,
            p.final_url,
            p.source_type,
            p.status,
            p.created_by,
            p.last_synced_at,
            p.created_at,
            p.updated_at
         FROM affiliate_products p
         INNER JOIN affiliate_networks n ON n.id = p.network_id
         LEFT JOIN affiliate_categories c ON c.id = p.category_id
         WHERE ${conditions.join(" AND ")}
         LIMIT 1`,
        [id]
    );

    if (!rows.length) throw new Error("AFFILIATE_PRODUCT_NOT_FOUND");

    return rows[0];
}

async function getCategories(query = {}) {
    const conditions = [];
    const params = [];

    if (query.includeInactive !== true) {
        conditions.push("status = 'active'");
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [categories] = await db.execute(
        `SELECT id, name, slug, parent_id, status, sort_order
         FROM affiliate_categories
         ${where}
         ORDER BY sort_order ASC, name ASC`
    );

    return categories;
}

// =========================
// ADMIN: CREATE PRODUCT
// =========================

async function createProduct(data = {}, actorUserId, audit = {}) {
    const actor = auditInfo(actorUserId, audit);
    const product = normalizeProductInput(data);
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const network = await resolveNetwork(
            conn,
            data.networkId ?? data.network_id ?? data.networkCode
        );

        const categoryId = await validateCategory(
            conn,
            data.categoryId ?? data.category_id
        );

        const status = data.status || "draft";
        if (!PRODUCT_STATUSES.includes(status)) {
            throw new Error("INVALID_PRODUCT_STATUS");
        }

        const sourceType = data.sourceType || data.source_type || "manual";
        if (!SOURCE_TYPES.includes(sourceType)) {
            throw new Error("INVALID_PRODUCT_SOURCE");
        }

        const [result] = await conn.execute(
            `INSERT INTO affiliate_products (
                network_id,
                category_id,
                product_id,
                sku_id,
                title,
                short_description,
                price,
                currency,
                image_url,
                affiliate_link,
                final_url,
                source_type,
                status,
                created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                network.id,
                categoryId,
                product.productId,
                product.skuId,
                product.title,
                product.shortDescription || null,
                product.price,
                product.currency,
                product.imageUrl,
                product.affiliateLink,
                product.finalUrl,
                sourceType,
                status,
                actor.actorUserId
            ]
        );

        const productId = Number(result.insertId);

        await writeAudit(conn, {
            ...actor,
            action: "affiliate_product.created",
            entityType: "affiliate_product",
            entityId: productId,
            newData: {
                networkId: network.id,
                productId: product.productId,
                skuId: product.skuId,
                title: product.title,
                status,
                sourceType
            }
        });

        await conn.commit();

        return getProductDetail(productId, { includeInactive: true });
    } catch (err) {
        await conn.rollback();

        if (err.code === "ER_DUP_ENTRY") {
            throw new Error("AFFILIATE_PRODUCT_ALREADY_EXISTS");
        }

        throw err;
    } finally {
        conn.release();
    }
}

// =========================
// ADMIN: UPDATE PRODUCT
// =========================

async function updateProduct(productId, data = {}, actorUserId, audit = {}) {
    const id = positiveId(productId);
    const actor = auditInfo(actorUserId, audit);
    const conn = await db.getConnection();

    const fields = {
        categoryId: "category_id",
        category_id: "category_id",
        productId: "product_id",
        product_id: "product_id",
        skuId: "sku_id",
        sku_id: "sku_id",
        title: "title",
        shortDescription: "short_description",
        short_description: "short_description",
        price: "price",
        currency: "currency",
        imageUrl: "image_url",
        image_url: "image_url",
        affiliateLink: "affiliate_link",
        affiliate_link: "affiliate_link",
        finalUrl: "final_url",
        final_url: "final_url"
    };

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT *
             FROM affiliate_products
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (!rows.length) throw new Error("AFFILIATE_PRODUCT_NOT_FOUND");

        const oldProduct = rows[0];
        const updates = {};
        const newData = {};

        for (const [inputKey, column] of Object.entries(fields)) {
            if (!Object.prototype.hasOwnProperty.call(data, inputKey)) continue;

            let value = data[inputKey];

            if (column === "category_id") {
                value = await validateCategory(conn, value);
            } else if (column === "product_id") {
                value = validText(value, 100, "INVALID_EXTERNAL_PRODUCT_ID", true);
            } else if (column === "sku_id") {
                value = validText(value, 100, "INVALID_EXTERNAL_SKU_ID");
            } else if (column === "title") {
                value = validText(value, 500, "INVALID_PRODUCT_TITLE", true);
            } else if (column === "short_description") {
                value = validText(value, 5000, "INVALID_PRODUCT_DESCRIPTION") || null;
            } else if (column === "price") {
                value = validPrice(value);
            } else if (column === "currency") {
                value = validCurrency(value);
            } else if (column === "image_url") {
                value = validUrl(value, "INVALID_PRODUCT_IMAGE_URL");
            } else if (column === "affiliate_link") {
                value = validUrl(value, "INVALID_AFFILIATE_LINK", true);
            } else if (column === "final_url") {
                value = validUrl(value, "INVALID_FINAL_URL");
            }

            updates[column] = value;
            newData[column] = value;
        }

        if (!Object.keys(updates).length) {
            throw new Error("NO_PRODUCT_FIELDS_TO_UPDATE");
        }

        const columns = Object.keys(updates);
        const assignments = columns.map(column => `${column} = ?`);

        await conn.execute(
            `UPDATE affiliate_products
             SET ${assignments.join(", ")}
             WHERE id = ?`,
            [...columns.map(column => updates[column]), id]
        );

        const oldData = {};
        for (const column of columns) {
            oldData[column] = oldProduct[column];
        }

        await writeAudit(conn, {
            ...actor,
            action: "affiliate_product.updated",
            entityType: "affiliate_product",
            entityId: id,
            oldData,
            newData
        });

        await conn.commit();

        return getProductDetail(id, { includeInactive: true });
    } catch (err) {
        await conn.rollback();

        if (err.code === "ER_DUP_ENTRY") {
            throw new Error("AFFILIATE_PRODUCT_ALREADY_EXISTS");
        }

        throw err;
    } finally {
        conn.release();
    }
}

// =========================
// ADMIN: CHANGE STATUS
// =========================

async function changeProductStatus(productId, actorUserId, newStatus, audit = {}) {
    const id = positiveId(productId);
    const actor = auditInfo(actorUserId, audit);

    if (!PRODUCT_STATUSES.includes(newStatus)) {
        throw new Error("INVALID_PRODUCT_STATUS");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT id, title, status, product_id, sku_id
             FROM affiliate_products
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (!rows.length) throw new Error("AFFILIATE_PRODUCT_NOT_FOUND");

        const product = rows[0];

        if (product.status === newStatus) {
            throw new Error("AFFILIATE_PRODUCT_STATUS_UNCHANGED");
        }

        await conn.execute(
            `UPDATE affiliate_products
             SET status = ?
             WHERE id = ?`,
            [newStatus, id]
        );

        await writeAudit(conn, {
            ...actor,
            action: "affiliate_product.status_changed",
            entityType: "affiliate_product",
            entityId: id,
            oldData: {
                status: product.status
            },
            newData: {
                status: newStatus
            }
        });

        await conn.commit();

        return {
            id,
            productId: product.product_id,
            skuId: product.sku_id,
            title: product.title,
            status: newStatus
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}


// =========================
// ADMIN: BULK APPROVE
// =========================

async function bulkApproveProducts(productIds, actorUserId, audit = {}) {
    if (!Array.isArray(productIds) || !productIds.length || productIds.length > 100) {
        throw new Error("INVALID_BULK_PRODUCT_IDS");
    }

    const ids = [...new Set(productIds.map(id => positiveId(id)))];
    const actor = auditInfo(actorUserId, audit);
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const placeholders = ids.map(() => "?").join(",");

        const [rows] = await conn.execute(
            `SELECT id, title, status, product_id, sku_id
             FROM affiliate_products
             WHERE id IN (${placeholders})
               AND status = 'draft'
             ORDER BY id ASC
             FOR UPDATE`,
            ids
        );

        if (rows.length) {
            const approvedIds = rows.map(product => product.id);
            const updatePlaceholders = approvedIds.map(() => "?").join(",");

            await conn.execute(
                `UPDATE affiliate_products
                 SET status = 'active'
                 WHERE id IN (${updatePlaceholders})
                   AND status = 'draft'`,
                approvedIds
            );

            for (const product of rows) {
                await writeAudit(conn, {
                    ...actor,
                    action: "affiliate_product.status_changed",
                    entityType: "affiliate_product",
                    entityId: product.id,
                    oldData: { status: "draft" },
                    newData: { status: "active" }
                });
            }
        }

        await conn.commit();

        return {
            approvedCount: rows.length,
            skippedCount: ids.length - rows.length,
            products: rows.map(product => ({
                id: product.id,
                productId: product.product_id,
                skuId: product.sku_id,
                title: product.title,
                status: "active"
            }))
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function bulkApproveAllDraftProducts(query = {}, actorUserId, audit = {}) {
    const actor = auditInfo(actorUserId, audit);
    const conditions = ["p.status = 'draft'"];
    const params = [];

    if (query.network_id) {
        conditions.push("p.network_id = ?");
        params.push(
            positiveId(query.network_id, "INVALID_AFFILIATE_NETWORK_ID")
        );
    }

    if (query.category_id) {
        conditions.push("p.category_id = ?");
        params.push(positiveId(query.category_id, "INVALID_CATEGORY_ID"));
    }

    if (query.search) {
        const search = validText(query.search, 255, "INVALID_SEARCH");

        if (search) {
            conditions.push(`(
                p.title LIKE ?
                OR p.product_id LIKE ?
                OR p.sku_id LIKE ?
            )`);

            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword);
        }
    }

    const where = conditions.join(" AND ");
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT
                p.id,
                p.title,
                p.product_id,
                p.sku_id
             FROM affiliate_products p
             WHERE ${where}
             ORDER BY p.id ASC
             FOR UPDATE`,
            params
        );

        if (rows.length) {
            await conn.execute(
                `UPDATE affiliate_products p
                 SET p.status = 'active'
                 WHERE ${where}`,
                params
            );

            for (const product of rows) {
                await writeAudit(conn, {
                    ...actor,
                    action: "affiliate_product.status_changed",
                    entityType: "affiliate_product",
                    entityId: product.id,
                    oldData: { status: "draft" },
                    newData: { status: "active" }
                });
            }
        }

        await conn.commit();

        return {
            approvedCount: rows.length,
            products: rows.map(product => ({
                id: product.id,
                productId: product.product_id,
                skuId: product.sku_id,
                title: product.title,
                status: "active"
            }))
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    getProducts,
    getAdminProducts,
    getProductDetail,
    getCategories,
    createProduct,
    updateProduct,
    changeProductStatus,
    bulkApproveProducts,
    bulkApproveAllDraftProducts
};
