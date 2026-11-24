
"use strict";

const db = require("../db");

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_COMMISSION_ID");
    return id;
}

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

function buildFilters(params = {}) {
    const filters = [];
    const values = [];

    if (params.status && COMMISSION_STATUSES.includes(params.status)) {
        filters.push("c.status = ?");
        values.push(params.status);
    }

    if (params.payout_method && PAYOUT_METHODS.includes(params.payout_method)) {
        filters.push("c.payout_method = ?");
        values.push(params.payout_method);
    }

    if (params.seller_id) {
        filters.push("c.seller_id = ?");
        values.push(validId(params.seller_id));
    }

    if (params.seller_user_id) {
        filters.push("c.seller_user_id = ?");
        values.push(validId(params.seller_user_id));
    }

    if (params.order_id) {
        filters.push("c.order_id = ?");
        values.push(validId(params.order_id));
    }

    if (params.date_from) {
        filters.push("c.created_at >= ?");
        values.push(`${String(params.date_from).slice(0, 10)} 00:00:00`);
    }

    if (params.date_to) {
        filters.push("c.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
        values.push(String(params.date_to).slice(0, 10));
    }

    if (params.search) {
        const keyword = `%${String(params.search).trim().slice(0, 150)}%`;
        filters.push(`(
            CAST(c.id AS CHAR) LIKE ?
            OR CAST(c.order_id AS CHAR) LIKE ?
            OR CAST(c.order_item_id AS CHAR) LIKE ?
            OR o.order_code LIKE ?
            OR oi.product_title LIKE ?
            OR s.display_name LIKE ?
            OR CAST(c.seller_user_id AS CHAR) LIKE ?
        )`);
        values.push(...Array(7).fill(keyword));
    }

    return {
        where: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
        values
    };
}

const PAYOUT_SUMMARY_JOIN = `
    LEFT JOIN (
        SELECT
            pi.commission_id,
            COUNT(*) AS payout_item_count,
            SUM(pi.amount) AS payout_amount,
            GROUP_CONCAT(DISTINCT pr.request_code ORDER BY pr.created_at DESC SEPARATOR ', ') AS payout_codes,
            GROUP_CONCAT(DISTINCT pr.status ORDER BY pr.created_at DESC SEPARATOR ', ') AS payout_statuses,
            MAX(pr.requested_at) AS last_payout_requested_at
        FROM marketplace_payout_items pi
        INNER JOIN marketplace_payout_requests pr
            ON pr.id = pi.payout_request_id
        GROUP BY pi.commission_id
    ) payout ON payout.commission_id = c.id
`;

const BASE_SELECT = `
    SELECT
        c.*,
        o.order_code,
        o.buyer_user_id,
        o.order_status,
        o.payment_status,
        o.total_amount AS order_total_amount,
        o.created_at AS order_created_at,
        oi.product_id,
        oi.product_title,
        oi.product_type,
        oi.quantity,
        oi.unit_price,
        oi.line_total,
        s.display_name AS seller_name,
        s.status AS seller_status,
        COALESCE(payout.payout_item_count, 0) AS payout_item_count,
        COALESCE(payout.payout_amount, 0) AS payout_amount,
        payout.payout_codes,
        payout.payout_statuses,
        payout.last_payout_requested_at
    FROM marketplace_commissions c
    INNER JOIN marketplace_orders o
        ON o.id = c.order_id
    INNER JOIN marketplace_order_items oi
        ON oi.id = c.order_item_id
    LEFT JOIN marketplace_sellers s
        ON s.user_id = c.seller_user_id
    ${PAYOUT_SUMMARY_JOIN}
`;

async function getCommissions(params = {}) {
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { where, values } = buildFilters(params);

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_commissions c
         INNER JOIN marketplace_orders o ON o.id = c.order_id
         INNER JOIN marketplace_order_items oi ON oi.id = c.order_item_id
         LEFT JOIN marketplace_sellers s ON s.user_id = c.seller_user_id
         ${where}`,
        values
    );

    const [rows] = await db.execute(
        `${BASE_SELECT}
         ${where}
         ORDER BY c.created_at DESC, c.id DESC
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

async function getCommissionDetail(commissionId) {
    commissionId = validId(commissionId);

    const [rows] = await db.execute(
        `${BASE_SELECT}
         WHERE c.id = ?
         LIMIT 1`,
        [commissionId]
    );

    if (!rows.length) fail("COMMISSION_NOT_FOUND");

    const commission = rows[0];

    
    const [holds] = await db.execute(
        `SELECT
            h.id,
            h.commission_id,
            h.hold_type,
            h.reference_type,
            h.reference_id,
            h.reason,
            h.status,
            h.created_by_user_id,
            h.released_by_user_id,
            h.created_at,
            h.released_at
         FROM marketplace_commission_holds h
         WHERE h.commission_id = ?
         ORDER BY h.created_at DESC, h.id DESC`,
        [commissionId]
    );


    const [tickets] = await db.execute(
        `SELECT
            id,
            ticket_code,
            order_id,
            order_item_id,
            category,
            subject,
            status,
            resolution,
            created_at,
            updated_at,
            resolved_at,
            closed_at
         FROM marketplace_support_tickets
         WHERE order_id = ?
           AND (order_item_id = ? OR order_item_id IS NULL)
         ORDER BY created_at DESC, id DESC`,
        [commission.order_id, commission.order_item_id]
    );

    const [payouts] = await db.execute(
        `SELECT
            pi.id AS payout_item_id,
            pi.amount,
            pi.currency,
            pi.status AS payout_item_status,
            pi.created_at AS payout_item_created_at,
            pr.id AS payout_request_id,
            pr.request_code,
            pr.payout_method,
            pr.total_amount AS payout_total_amount,
            pr.status AS payout_status,
            pr.admin_note,
            pr.rejection_reason,
            pr.transaction_reference,
            pr.requested_at,
            pr.reviewed_at,
            pr.paid_at
         FROM marketplace_payout_items pi
         INNER JOIN marketplace_payout_requests pr
            ON pr.id = pi.payout_request_id
         WHERE pi.commission_id = ?
         ORDER BY pr.created_at DESC, pr.id DESC`,
        [commissionId]
    );

    return {
        commission,
        holds,
        tickets,
        payouts
    };
}

async function getCommissionStatistics(params = {}) {
    const { where, values } = buildFilters(params);

    const [summaryRows] = await db.execute(
        `SELECT
            COUNT(*) AS total_count,
            COALESCE(SUM(c.commissionable_amount), 0) AS commissionable_total,
            COALESCE(SUM(c.seller_amount), 0) AS seller_amount_total,
            COALESCE(SUM(c.platform_amount), 0) AS platform_amount_total,
            COALESCE(SUM(c.paid_amount), 0) AS paid_amount_total,
            COALESCE(SUM(c.reversed_amount), 0) AS reversed_amount_total,
            COALESCE(SUM(
                CASE WHEN c.status = 'pending_protection'
                    THEN c.seller_amount ELSE 0 END
            ), 0) AS pending_protection_amount,
            COALESCE(SUM(
                CASE WHEN c.status = 'available'
                    THEN GREATEST(c.seller_amount - c.paid_amount - c.reversed_amount, 0)
                    ELSE 0 END
            ), 0) AS available_amount,
            COALESCE(SUM(
                CASE WHEN c.status = 'on_hold'
                    THEN GREATEST(c.seller_amount - c.paid_amount - c.reversed_amount, 0)
                    ELSE 0 END
            ), 0) AS on_hold_amount
         FROM marketplace_commissions c
         INNER JOIN marketplace_orders o ON o.id = c.order_id
         INNER JOIN marketplace_order_items oi ON oi.id = c.order_item_id
         LEFT JOIN marketplace_sellers s ON s.user_id = c.seller_user_id
         ${where}`,
        values
    );

    const [statusRows] = await db.execute(
        `SELECT
            c.status,
            COUNT(*) AS count,
            COALESCE(SUM(c.seller_amount), 0) AS seller_amount,
            COALESCE(SUM(c.paid_amount), 0) AS paid_amount,
            COALESCE(SUM(c.reversed_amount), 0) AS reversed_amount
         FROM marketplace_commissions c
         INNER JOIN marketplace_orders o ON o.id = c.order_id
         INNER JOIN marketplace_order_items oi ON oi.id = c.order_item_id
         LEFT JOIN marketplace_sellers s ON s.user_id = c.seller_user_id
         ${where}
         GROUP BY c.status
         ORDER BY c.status`,
        values
    );

    return {
        summary: summaryRows[0] || {},
        byStatus: statusRows
    };
}

module.exports = {
    getCommissions,
    getCommissionDetail,
    getCommissionStatistics
};
