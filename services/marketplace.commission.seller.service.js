
"use strict";

const db = require("../db");

const COMMISSION_STATUSES = [
    "pending_protection",
    "available",
    "payout_requested",
    "paid",
    "on_hold",
    "partially_reversed",
    "reversed"
];

const PAYOUT_METHODS = ["credits", "cash"];

function fail(code) {
    throw new Error(code);
}

function validateUserId(userId) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        fail("INVALID_USER_ID");
    }

    return id;
}

function validateCommissionId(commissionId) {
    const id = Number(commissionId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        fail("INVALID_COMMISSION_ID");
    }

    return id;
}

function validateDate(value) {
    if (value === undefined || value === "") return null;

    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        fail("INVALID_COMMISSION_DATE_FILTER");
    }

    const date = new Date(`${value}T00:00:00Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        fail("INVALID_COMMISSION_DATE_FILTER");
    }

    return value;
}

function buildFilters(userId, filters = {}) {
    const conditions = ["c.seller_user_id = ?"];
    const params = [userId];

    if (filters.status) {
        if (!COMMISSION_STATUSES.includes(filters.status)) {
            fail("INVALID_COMMISSION_STATUS");
        }

        conditions.push("c.status = ?");
        params.push(filters.status);
    }

    if (filters.payout_method) {
        if (!PAYOUT_METHODS.includes(filters.payout_method)) {
            fail("INVALID_COMMISSION_PAYOUT_METHOD");
        }

        conditions.push("c.payout_method = ?");
        params.push(filters.payout_method);
    }

    const dateFrom = validateDate(filters.date_from);
    const dateTo = validateDate(filters.date_to);

    if (dateFrom && dateTo && dateFrom > dateTo) {
        fail("INVALID_COMMISSION_DATE_FILTER");
    }

    if (dateFrom) {
        conditions.push("c.created_at >= ?");
        params.push(`${dateFrom} 00:00:00`);
    }

    if (dateTo) {
        conditions.push("c.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
        params.push(`${dateTo} 00:00:00`);
    }

    if (filters.search !== undefined && filters.search !== "") {
        const search = String(filters.search).trim().slice(0, 150);

        if (search) {
            conditions.push(`(
                o.order_code LIKE ?
                OR oi.product_title LIKE ?
            )`);

            params.push(`%${search}%`, `%${search}%`);
        }
    }

    return {
        where: conditions.join(" AND "),
        params
    };
}

const BASE_SELECT = `
    SELECT
        c.id,
        c.order_id,
        c.order_item_id,
        c.seller_id,
        c.commissionable_amount,
        c.currency,
        c.seller_rate,
        c.platform_rate,
        c.seller_amount,
        c.platform_amount,
        c.protection_days,
        c.protection_started_at,
        c.protection_ends_at,
        c.eligible_at,
        c.payout_method,
        c.status,
        c.paid_amount,
        c.reversed_amount,
        c.paid_at,
        c.created_at,
        c.updated_at,

        o.order_code,
        o.order_status,
        o.payment_status,
        o.created_at AS order_created_at,

        oi.product_title,
        oi.product_type,
        oi.product_version,
        oi.quantity,
        oi.unit_price,
        oi.line_total,

        s.display_name AS seller_display_name,

        COALESCE(ps.payout_item_count, 0) AS payout_item_count,
        COALESCE(ps.payout_total_amount, 0) AS payout_total_amount,
        ps.payout_request_codes,
        ps.payout_statuses,
        ps.last_payout_requested_at

    FROM marketplace_commissions c

    LEFT JOIN marketplace_orders o
        ON o.id = c.order_id

    LEFT JOIN marketplace_order_items oi
        ON oi.id = c.order_item_id
       AND oi.order_id = c.order_id

    LEFT JOIN marketplace_sellers s
        ON s.id = c.seller_id
       AND s.user_id = c.seller_user_id

    LEFT JOIN (
        SELECT
            pi.commission_id,
            COUNT(*) AS payout_item_count,
            SUM(pi.amount) AS payout_total_amount,
            GROUP_CONCAT(
                DISTINCT pr.request_code
                ORDER BY pr.created_at DESC
                SEPARATOR ','
            ) AS payout_request_codes,
            GROUP_CONCAT(
                DISTINCT pr.status
                ORDER BY pr.created_at DESC
                SEPARATOR ','
            ) AS payout_statuses,
            MAX(pr.requested_at) AS last_payout_requested_at

        FROM marketplace_payout_items pi

        INNER JOIN marketplace_payout_requests pr
            ON pr.id = pi.payout_request_id

        GROUP BY pi.commission_id
    ) ps
        ON ps.commission_id = c.id
`;

async function getCommissions(userId, filters = {}) {
    const id = validateUserId(userId);
    const { where, params } = buildFilters(id, filters);

    const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
    const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(filters.limit, 10) || 20)
    );
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_commissions c
         LEFT JOIN marketplace_orders o ON o.id = c.order_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id AND oi.order_id = c.order_id
         WHERE ${where}`,
        params
    );

    const [items] = await db.execute(
        `${BASE_SELECT}
         WHERE ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit)
        }
    };
}

async function getCommissionStatistics(userId) {
    const id = validateUserId(userId);

    const [rows] = await db.execute(
        `SELECT
            COUNT(*) AS total_commissions,

            COALESCE(SUM(c.seller_amount), 0) AS total_seller_amount,
            COALESCE(SUM(c.platform_amount), 0) AS total_platform_amount,

            COALESCE(SUM(
                CASE WHEN c.status = 'pending_protection'
                THEN GREATEST(
                    c.seller_amount - c.paid_amount - c.reversed_amount,
                    0
                ) ELSE 0 END
            ), 0) AS pending_protection_amount,

            COALESCE(SUM(
                CASE WHEN c.status = 'available'
                THEN GREATEST(
                    c.seller_amount - c.paid_amount - c.reversed_amount,
                    0
                ) ELSE 0 END
            ), 0) AS available_amount,

            COALESCE(SUM(
                CASE WHEN c.status = 'payout_requested'
                THEN GREATEST(
                    c.seller_amount - c.paid_amount - c.reversed_amount,
                    0
                ) ELSE 0 END
            ), 0) AS payout_requested_amount,

            COALESCE(SUM(
                CASE WHEN c.status = 'on_hold'
                THEN GREATEST(
                    c.seller_amount - c.paid_amount - c.reversed_amount,
                    0
                ) ELSE 0 END
            ), 0) AS on_hold_amount,

            COALESCE(SUM(c.paid_amount), 0) AS paid_amount,
            COALESCE(SUM(c.reversed_amount), 0) AS reversed_amount

         FROM marketplace_commissions c
         WHERE c.seller_user_id = ?`,
        [id]
    );

    return rows[0];
}

async function getCommissionDetail(userId, commissionId) {
    const user = validateUserId(userId);
    const commission = validateCommissionId(commissionId);

    const [rows] = await db.execute(
        `${BASE_SELECT}
         WHERE c.seller_user_id = ?
           AND c.id = ?
         LIMIT 1`,
        [user, commission]
    );

    if (!rows.length) {
        fail("COMMISSION_NOT_FOUND");
    }

    const [holds] = await db.execute(
        `SELECT
            id,
            hold_type,
            reference_type,
            reference_id,
            reason,
            status,
            created_at,
            released_at
         FROM marketplace_commission_holds
         WHERE commission_id = ?
         ORDER BY created_at DESC, id DESC`,
        [commission]
    );

    const [payouts] = await db.execute(
        `SELECT
            pi.id AS payout_item_id,
            pi.payout_request_id,
            pi.amount,
            pi.currency,
            pi.status AS payout_item_status,
            pi.created_at AS payout_item_created_at,
            pr.request_code,
            pr.payout_method,
            pr.status AS payout_request_status,
            pr.requested_at,
            pr.reviewed_at,
            pr.paid_at,
            pr.transaction_reference
         FROM marketplace_payout_items pi
         INNER JOIN marketplace_payout_requests pr
            ON pr.id = pi.payout_request_id
         WHERE pi.commission_id = ?
           AND pr.seller_user_id = ?
         ORDER BY pr.requested_at DESC, pi.id DESC`,
        [commission, user]
    );

    return {
        commission: rows[0],
        holds,
        payouts
    };
}

module.exports = {
    getCommissions,
    getCommissionStatistics,
    getCommissionDetail
};
