"use strict";

const db = require("../db");

const DELIVERY_STATUSES = [
    "pending", "delivered", "confirmed", "failed", "replaced", "refunded"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_DELIVERY_ID");
    return id;
}

function pagination(value, fallback, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, max);
}

async function getDeliveries(params = {}) {
    const page = pagination(params.page, 1, 100000);
    const limit = pagination(params.limit, 20, 100);
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];

    if (DELIVERY_STATUSES.includes(String(params.status || ""))) {
        filters.push("d.status = ?");
        values.push(String(params.status));
    }

    if (params.search) {
        const search = `%${String(params.search).trim().slice(0, 100)}%`;
        filters.push(`(
            o.order_code LIKE ?
            OR buyer.email LIKE ?
            OR oi.product_title LIKE ?
            OR s.display_name LIKE ?
            OR s.contact_email LIKE ?
            OR seller_user.email LIKE ?
        )`);
        values.push(search, search, search, search, search, search);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const from = `
        FROM marketplace_deliveries d
        INNER JOIN marketplace_order_items oi ON oi.id = d.order_item_id
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
        LEFT JOIN marketplace_sellers s ON s.id = oi.seller_id
        LEFT JOIN users seller_user ON seller_user.id = oi.seller_user_id
        ${where}`;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total ${from}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            d.id,
            d.order_item_id,
            d.status,
            d.delivery_note,
            d.delivered_by_user_id,
            d.delivered_at,
            d.buyer_confirmed_at,
            d.protection_started_at,
            d.protection_ends_at,
            d.created_at,
            d.updated_at,
            o.id AS order_id,
            o.order_code,
            o.buyer_user_id,
            buyer.email AS buyer_email,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.line_total,
            oi.currency,
            oi.seller_id,
            oi.seller_user_id,
            s.display_name AS seller_name,
            COALESCE(s.contact_email, seller_user.email) AS seller_email,
            (
                SELECT COUNT(*)
                FROM marketplace_delivery_files df
                WHERE df.delivery_id = d.id
            ) AS file_count
         ${from}
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return {
        items: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getDeliveryDetail(deliveryId) {
    deliveryId = validId(deliveryId);

    const [rows] = await db.execute(
        `SELECT
            d.*,
            o.id AS order_id,
            o.order_code,
            o.buyer_user_id,
            buyer.email AS buyer_email,
            o.payment_status,
            o.order_status,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.product_type,
            oi.line_total,
            oi.currency,
            oi.seller_id,
            oi.seller_user_id,
            s.display_name AS seller_name,
            COALESCE(s.contact_email, seller_user.email) AS seller_email,
            s.contact_phone AS seller_phone,
            c.id AS commission_id,
            c.status AS commission_status,
            c.commissionable_amount,
            c.seller_rate,
            c.platform_rate,
            c.seller_amount,
            c.platform_amount,
            c.eligible_at,
            c.paid_amount,
            c.reversed_amount
         FROM marketplace_deliveries d
         INNER JOIN marketplace_order_items oi ON oi.id = d.order_item_id
         INNER JOIN marketplace_orders o ON o.id = oi.order_id
         LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
         LEFT JOIN marketplace_sellers s ON s.id = oi.seller_id
         LEFT JOIN users seller_user ON seller_user.id = oi.seller_user_id
         LEFT JOIN marketplace_commissions c ON c.order_item_id = oi.id
         WHERE d.id = ?
         LIMIT 1`,
        [deliveryId]
    );

    if (!rows.length) fail("DELIVERY_NOT_FOUND");

    // Chỉ trả metadata hiển thị; tuyệt đối không trả storage_key hoặc file_hash.
    const [files] = await db.execute(
        `SELECT
            pf.id,
            pf.product_id,
            pf.file_role,
            pf.original_name,
            pf.mime_type,
            pf.file_size,
            pf.version,
            pf.is_active,
            pf.uploaded_by_user_id,
            pf.created_at
         FROM marketplace_delivery_files df
         INNER JOIN marketplace_product_files pf
            ON pf.id = df.product_file_id
         WHERE df.delivery_id = ?
         ORDER BY df.id ASC`,
        [deliveryId]
    );

    return {
        delivery: rows[0],
        files
    };
}

module.exports = {
    getDeliveries,
    getDeliveryDetail
};
