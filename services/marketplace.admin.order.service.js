"use strict";

const db = require("../db");

const ORDER_STATUSES = [
    "pending_payment", "processing", "paid", "partially_delivered",
    "delivered", "completed", "cancelled", "disputed", "refunded"
];

const PAYMENT_STATUSES = [
    "pending", "processing", "paid", "failed", "cancelled",
    "refunded", "partially_refunded"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_ORDER_ID");
    return id;
}

function pagination(value, fallback, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, max);
}

async function getOrders(params = {}) {
    const page = pagination(params.page, 1, 100000);
    const limit = pagination(params.limit, 20, 100);
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];

    if (ORDER_STATUSES.includes(String(params.orderStatus || params.status || ""))) {
        filters.push("o.order_status = ?");
        values.push(String(params.orderStatus || params.status));
    }

    if (PAYMENT_STATUSES.includes(String(params.paymentStatus || ""))) {
        filters.push("o.payment_status = ?");
        values.push(String(params.paymentStatus));
    }

    if (params.search) {
        const search = `%${String(params.search).trim().slice(0, 100)}%`;
        filters.push(`(
            o.order_code LIKE ?
            OR buyer.email LIKE ?
            OR EXISTS (
                SELECT 1
                FROM marketplace_order_items soi
                LEFT JOIN marketplace_sellers ss ON ss.id = soi.seller_id
                LEFT JOIN users su ON su.id = soi.seller_user_id
                WHERE soi.order_id = o.id
                  AND (
                    soi.product_title LIKE ?
                    OR ss.display_name LIKE ?
                    OR ss.contact_email LIKE ?
                    OR su.email LIKE ?
                  )
            )
        )`);
        values.push(search, search, search, search, search, search);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_orders o
         LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
         ${where}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            o.id,
            o.order_code,
            o.buyer_user_id,
            buyer.email AS buyer_email,
            o.subtotal,
            o.discount_amount,
            o.total_amount,
            o.currency,
            o.payment_status,
            o.order_status,
            o.paid_at,
            o.payment_deadline_at,
            o.completed_at,
            o.cancelled_at,
            o.created_at,
            o.updated_at,
            (
                SELECT COUNT(*)
                FROM marketplace_order_items oi
                WHERE oi.order_id = o.id
            ) AS item_count,
            (
                SELECT COUNT(*)
                FROM marketplace_order_items oi
                INNER JOIN marketplace_deliveries d
                    ON d.order_item_id = oi.id
                WHERE oi.order_id = o.id
                  AND d.status IN ('delivered', 'confirmed')
            ) AS delivered_item_count,
            (
                SELECT COUNT(*)
                FROM marketplace_order_payments p
                WHERE p.order_id = o.id
            ) AS payment_count,
            (
                SELECT GROUP_CONCAT(
                    DISTINCT COALESCE(s.display_name, su.email)
                    ORDER BY s.display_name SEPARATOR ', '
                )
                FROM marketplace_order_items oi
                LEFT JOIN marketplace_sellers s ON s.id = oi.seller_id
                LEFT JOIN users su ON su.id = oi.seller_user_id
                WHERE oi.order_id = o.id
            ) AS seller_names
         FROM marketplace_orders o
         LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
         ${where}
         ORDER BY o.created_at DESC, o.id DESC
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

async function getOrderDetail(orderId) {
    orderId = validId(orderId);

    const [orders] = await db.execute(
        `SELECT
            o.*,
            buyer.email AS buyer_email
         FROM marketplace_orders o
         LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
         WHERE o.id = ?
         LIMIT 1`,
        [orderId]
    );

    if (!orders.length) fail("ORDER_NOT_FOUND");

    const [items] = await db.execute(
        `SELECT
            oi.id,
            oi.order_id,
            oi.product_id,
            oi.seller_id,
            oi.seller_user_id,
            oi.product_title,
            oi.product_version,
            oi.product_type,
            oi.license_snapshot,
            oi.unit_price,
            oi.quantity,
            oi.line_total,
            oi.currency,
            oi.created_at,
            s.display_name AS seller_name,
            COALESCE(s.contact_email, seller_user.email) AS seller_email,
            s.contact_phone AS seller_phone,
            d.id AS delivery_id,
            d.status AS delivery_status,
            d.delivered_at,
            d.buyer_confirmed_at,
            d.protection_started_at,
            d.protection_ends_at,
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
         FROM marketplace_order_items oi
         LEFT JOIN marketplace_sellers s ON s.id = oi.seller_id
         LEFT JOIN users seller_user ON seller_user.id = oi.seller_user_id
         LEFT JOIN marketplace_deliveries d ON d.order_item_id = oi.id
         LEFT JOIN marketplace_commissions c ON c.order_item_id = oi.id
         WHERE oi.order_id = ?
         ORDER BY oi.id ASC`,
        [orderId]
    );

    // Không trả storage_key, payment_metadata hoặc verification_note.
    const [payments] = await db.execute(
        `SELECT
            id,
            order_id,
            payment_method,
            amount,
            currency,
            status,
            provider,
            provider_transaction_id,
            transaction_reference,
            submitted_at,
            verified_by_user_id,
            verified_at,
            paid_at,
            created_at,
            updated_at
         FROM marketplace_order_payments
         WHERE order_id = ?
         ORDER BY created_at ASC, id ASC`,
        [orderId]
    );

    return {
        order: orders[0],
        items,
        payments
    };
}

module.exports = {
    getOrders,
    getOrderDetail
};
