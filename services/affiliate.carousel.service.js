
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const TABLE = "affiliate_carousels";
const PRODUCT_TABLE = "affiliate_products";

const DISPLAY_MODES = ["auto", "manual"];
const SORT_MODES = ["newest", "oldest", "price_asc", "price_desc", "random"];

const DEFAULT_PRODUCT_LIMIT = 10;
const MAX_PRODUCT_LIMIT = 100;

function positiveId(value, error = "INVALID_CAROUSEL_ID") {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }

    return id;
}

function validText(value, maxLength, error) {
    if (typeof value !== "string") {
        throw new Error(error);
    }

    const text = value.trim();

    if (!text || text.length > maxLength) {
        throw new Error(error);
    }

    return text;
}

function normalizeSlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeProductLimit(value) {
    const limit = Number(value);

    if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_PRODUCT_LIMIT
    ) {
        throw new Error("INVALID_CAROUSEL_PRODUCT_LIMIT");
    }

    return limit;
}

function normalizeManualProductIds(value) {
    if (value == null) return [];

    if (!Array.isArray(value)) {
        throw new Error("INVALID_MANUAL_PRODUCT_IDS");
    }

    const ids = value.map(id =>
        positiveId(id, "INVALID_MANUAL_PRODUCT_ID")
    );

    return [...new Set(ids)];
}

function parseManualProductIds(value) {
    if (Array.isArray(value)) return value;

    if (!value) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeMode(value, allowed, error) {
    if (!allowed.includes(value)) {
        throw new Error(error);
    }

    return value;
}

function auditInfo(options = {}) {
    return {
        actorUserId: options.actorUserId ?? options.userId ?? null,
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null
    };
}


function normalizeInput(data = {}, oldData = null) {
    const source = { ...(oldData || {}) };

    // Chỉ ghi đè những trường được gửi lên.
    // undefined được xem như không gửi; null vẫn được giữ để xóa dữ liệu.
    const allowedFields = [
        "name",
        "slug",
        "description",
        "is_enabled",
        "display_mode",
        "category_id",
        "network_id",
        "product_limit",
        "sort_mode",
        "manual_product_ids"
    ];

    for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
            source[key] = data[key];
        }
    }

    const name = validText(
        source.name,
        150,
        "INVALID_CAROUSEL_NAME"
    );

    // Chỉ tạo slug từ name khi tạo mới.
    // Khi cập nhật, slug chỉ thay đổi nếu Admin gửi slug mới.
    let slug;

    if (oldData) {
        slug = Object.prototype.hasOwnProperty.call(data, "slug") &&
            data.slug !== undefined
            ? normalizeSlug(data.slug)
            : oldData.slug;
    } else {
        slug = normalizeSlug(source.slug || name);
    }

    if (!slug) {
        throw new Error("INVALID_CAROUSEL_SLUG");
    }

    const description = source.description == null ||
        String(source.description).trim() === ""
        ? null
        : validText(
            source.description,
            500,
            "INVALID_CAROUSEL_DESCRIPTION"
        );

    const displayMode = normalizeMode(
        source.display_mode || "auto",
        ["auto", "manual"],
        "INVALID_CAROUSEL_DISPLAY_MODE"
    );

    const sortMode = normalizeMode(
        source.sort_mode || "newest",
        ["newest", "oldest", "price_asc", "price_desc", "random"],
        "INVALID_CAROUSEL_SORT_MODE"
    );

    const productLimit = normalizeProductLimit(
        source.product_limit == null ? 10 : source.product_limit
    );

    const categoryId = source.category_id == null ||
        source.category_id === ""
        ? null
        : positiveId(source.category_id, "INVALID_CATEGORY_ID");

    const networkId = source.network_id == null ||
        source.network_id === ""
        ? null
        : positiveId(source.network_id, "INVALID_NETWORK_ID");

    const manualProductIds = normalizeManualProductIds(
        source.manual_product_ids == null
            ? []
            : source.manual_product_ids
    );

    const isEnabled =
        source.is_enabled === true ||
        Number(source.is_enabled) === 1;

    return {
        name,
        slug,
        description,
        is_enabled: isEnabled ? 1 : 0,
        display_mode: displayMode,
        category_id: categoryId,
        network_id: networkId,
        product_limit: productLimit,
        sort_mode: sortMode,
        manual_product_ids: manualProductIds
    };
}


async function getConnection() {
    return db.getConnection();
}

async function getCarouselById(id, conn = db) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM ${TABLE}
         WHERE id = ?
         LIMIT 1`,
        [positiveId(id)]
    );

    return rows[0] || null;
}

async function getCarouselBySlug(slug, conn = db) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM ${TABLE}
         WHERE slug = ?
         LIMIT 1`,
        [String(slug || "").trim()]
    );

    return rows[0] || null;
}

async function assertReferences(data, conn = db) {
    if (data.category_id) {
        const [rows] = await conn.execute(
            `SELECT id
             FROM affiliate_categories
             WHERE id = ?
             LIMIT 1`,
            [data.category_id]
        );

        if (!rows.length) {
            throw new Error("CATEGORY_NOT_FOUND");
        }
    }

    if (data.network_id) {
        const [rows] = await conn.execute(
            `SELECT id
             FROM affiliate_networks
             WHERE id = ?
             LIMIT 1`,
            [data.network_id]
        );

        if (!rows.length) {
            throw new Error("NETWORK_NOT_FOUND");
        }
    }

    if (data.manual_product_ids.length) {
        const placeholders = data.manual_product_ids.map(() => "?").join(",");

        const [rows] = await conn.execute(
            `SELECT id
             FROM ${PRODUCT_TABLE}
             WHERE id IN (${placeholders})`,
            data.manual_product_ids
        );

        const foundIds = new Set(rows.map(row => Number(row.id)));

        const missingIds = data.manual_product_ids.filter(
            id => !foundIds.has(id)
        );

        if (missingIds.length) {
            throw new Error("CAROUSEL_PRODUCT_NOT_FOUND");
        }
    }
}

function serializeCarousel(row) {
    if (!row) return null;

    return {
        ...row,
        is_enabled: Number(row.is_enabled),
        category_id: row.category_id == null ? null : Number(row.category_id),
        network_id: row.network_id == null ? null : Number(row.network_id),
        product_limit: Number(row.product_limit),
        manual_product_ids: parseManualProductIds(row.manual_product_ids)
    };
}

async function getCarousels(query = {}) {
    const conditions = [];
    const params = [];

    if (query.status === "enabled") {
        conditions.push("is_enabled = 1");
    } else if (query.status === "disabled") {
        conditions.push("is_enabled = 0");
    }

    if (query.search) {
        conditions.push("(name LIKE ? OR slug LIKE ?)");
        const keyword = `%${String(query.search).trim()}%`;
        params.push(keyword, keyword);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [rows] = await db.execute(
        `SELECT *
         FROM ${TABLE}
         ${where}
         ORDER BY updated_at DESC, id DESC`,
        params
    );

    return {
        carousels: rows.map(serializeCarousel),
        total: rows.length
    };
}

async function getCarouselDetail(id) {
    const row = await getCarouselById(id);

    if (!row) {
        throw new Error("CAROUSEL_NOT_FOUND");
    }

    return serializeCarousel(row);
}

async function createCarousel(data = {}, options = {}) {
    const conn = await getConnection();

    try {
        await conn.beginTransaction();

        const input = normalizeInput(data);

        await assertReferences(input, conn);

        const [existing] = await conn.execute(
            `SELECT id
             FROM ${TABLE}
             WHERE slug = ?
             LIMIT 1`,
            [input.slug]
        );

        if (existing.length) {
            throw new Error("CAROUSEL_SLUG_EXISTS");
        }

        const actor = auditInfo(options);

        const [result] = await conn.execute(
            `INSERT INTO ${TABLE} (
                name,
                slug,
                description,
                is_enabled,
                display_mode,
                category_id,
                network_id,
                product_limit,
                sort_mode,
                manual_product_ids,
                created_by,
                updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                input.name,
                input.slug,
                input.description,
                input.is_enabled,
                input.display_mode,
                input.category_id,
                input.network_id,
                input.product_limit,
                input.sort_mode,
                JSON.stringify(input.manual_product_ids),
                actor.actorUserId,
                actor.actorUserId
            ]
        );

        await writeAudit(conn, {
            ...actor,
            action: "affiliate.carousel.create",
            entityType: "affiliate_carousel",
            entityId: result.insertId,
            newData: input
        });

        await conn.commit();

        return getCarouselDetail(result.insertId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function updateCarousel(id, data = {}, options = {}) {
    const carouselId = positiveId(id);
    const conn = await getConnection();

    try {
        await conn.beginTransaction();

        const oldRow = await getCarouselById(carouselId, conn);

        if (!oldRow) {
            throw new Error("CAROUSEL_NOT_FOUND");
        }

        const oldData = serializeCarousel(oldRow);
        const input = normalizeInput(data, oldData);

        await assertReferences(input, conn);

        const [existing] = await conn.execute(
            `SELECT id
             FROM ${TABLE}
             WHERE slug = ?
               AND id <> ?
             LIMIT 1`,
            [input.slug, carouselId]
        );

        if (existing.length) {
            throw new Error("CAROUSEL_SLUG_EXISTS");
        }

        const actor = auditInfo(options);

        await conn.execute(
            `UPDATE ${TABLE}
             SET
                name = ?,
                slug = ?,
                description = ?,
                is_enabled = ?,
                display_mode = ?,
                category_id = ?,
                network_id = ?,
                product_limit = ?,
                sort_mode = ?,
                manual_product_ids = ?,
                updated_by = ?
             WHERE id = ?`,
            [
                input.name,
                input.slug,
                input.description,
                input.is_enabled,
                input.display_mode,
                input.category_id,
                input.network_id,
                input.product_limit,
                input.sort_mode,
                JSON.stringify(input.manual_product_ids),
                actor.actorUserId,
                carouselId
            ]
        );

        await writeAudit(conn, {
            ...actor,
            action: "affiliate.carousel.update",
            entityType: "affiliate_carousel",
            entityId: carouselId,
            oldData,
            newData: input
        });

        await conn.commit();

        return getCarouselDetail(carouselId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function deleteCarousel(id, options = {}) {
    const carouselId = positiveId(id);
    const conn = await getConnection();

    try {
        await conn.beginTransaction();

        const oldRow = await getCarouselById(carouselId, conn);

        if (!oldRow) {
            throw new Error("CAROUSEL_NOT_FOUND");
        }

        const actor = auditInfo(options);

        await conn.execute(
            `DELETE FROM ${TABLE}
             WHERE id = ?`,
            [carouselId]
        );

        await writeAudit(conn, {
            ...actor,
            action: "affiliate.carousel.delete",
            entityType: "affiliate_carousel",
            entityId: carouselId,
            oldData: serializeCarousel(oldRow)
        });

        await conn.commit();

        return {
            success: true,
            id: carouselId
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

function buildProductOrder(sortMode, manualIds = []) {
    if (sortMode === "oldest") {
        return "p.created_at ASC, p.id ASC";
    }

    if (sortMode === "price_asc") {
        return "p.price ASC, p.id DESC";
    }

    if (sortMode === "price_desc") {
        return "p.price DESC, p.id DESC";
    }

    if (sortMode === "random") {
        return "RAND()";
    }

    if (manualIds.length) {
        return `FIELD(p.id, ${manualIds.map(() => "?").join(",")})`;
    }

    return "p.created_at DESC, p.id DESC";
}

async function getCarouselProducts(carousel, options = {}) {
    const config = typeof carousel === "object"
        ? serializeCarousel(carousel)
        : await getCarouselDetail(carousel);

    if (!config) {
        throw new Error("CAROUSEL_NOT_FOUND");
    }

    const conditions = ["p.status = 'active'"];
    const params = [];

    if (config.category_id) {
        conditions.push("p.category_id = ?");
        params.push(config.category_id);
    }

    if (config.network_id) {
        conditions.push("p.network_id = ?");
        params.push(config.network_id);
    }

    let manualIds = [];

    if (config.display_mode === "manual") {
        manualIds = config.manual_product_ids;

        if (!manualIds.length) {
            return [];
        }

        conditions.push(
            `p.id IN (${manualIds.map(() => "?").join(",")})`
        );

        params.push(...manualIds);
    }

    const orderBy = config.display_mode === "manual"
        ? `FIELD(p.id, ${manualIds.map(() => "?").join(",")})`
        : buildProductOrder(config.sort_mode);

    if (config.display_mode === "manual") {
        params.push(...manualIds);
    }

    const requestedLimit = options.limit == null
        ? config.product_limit
        : normalizeProductLimit(options.limit);

    const limit = Math.min(requestedLimit, MAX_PRODUCT_LIMIT);

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
         FROM ${PRODUCT_TABLE} p
         LEFT JOIN affiliate_networks n
            ON n.id = p.network_id
         LEFT JOIN affiliate_categories c
            ON c.id = p.category_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY ${orderBy}
         LIMIT ?`,
        [...params, limit]
    );

    return rows;
}

async function getPublicCarousel(slug) {
    const carousel = await getCarouselBySlug(slug);

    if (!carousel || Number(carousel.is_enabled) !== 1) {
        return null;
    }

    const config = serializeCarousel(carousel);
    const products = await getCarouselProducts(config);

    return {
        id: config.id,
        name: config.name,
        slug: config.slug,
        description: config.description,
        products
    };
}

module.exports = {
    getCarousels,
    getCarouselDetail,
    createCarousel,
    updateCarousel,
    deleteCarousel,
    getCarouselProducts,
    getPublicCarousel
};
