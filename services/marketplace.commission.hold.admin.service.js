
"use strict";

const db = require("../db");
const auditService = require("./contributor.audit.service");

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_ID");
    return id;
}

async function getCommissionHolds(params = {}) {
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const filters = [];
    const values = [];

    if (params.status && ["active", "released"].includes(params.status)) {
        filters.push("h.status = ?");
        values.push(params.status);
    }

    if (params.hold_type) {
        filters.push("h.hold_type = ?");
        values.push(String(params.hold_type));
    }

    if (params.commission_id) {
        filters.push("h.commission_id = ?");
        values.push(validId(params.commission_id));
    }

    const where = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_commission_holds h
         ${where}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            h.*,
            c.order_id,
            c.order_item_id,
            c.seller_id,
            c.seller_user_id,
            c.status AS commission_status,
            c.commissionable_amount,
            c.seller_amount,
            c.platform_amount,
            c.eligible_at
         FROM marketplace_commission_holds h
         INNER JOIN marketplace_commissions c
            ON c.id = h.commission_id
         ${where}
         ORDER BY h.created_at DESC, h.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    const total = Number(countRows[0].total || 0);

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

async function createAdminHold(commissionId, actorUserId, data = {}, auditInfo = {}) {
    commissionId = validId(commissionId);
    actorUserId = validId(actorUserId);

    const reason = String(data.reason || "").trim();

    if (!reason || reason.length > 5000) {
        fail("INVALID_COMMISSION_HOLD_REASON");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [commissions] = await conn.execute(
            `SELECT id, status
             FROM marketplace_commissions
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [commissionId]
        );

        if (!commissions.length) {
            fail("COMMISSION_NOT_FOUND");
        }

        const commission = commissions[0];

        if (!["pending_protection", "available", "on_hold"].includes(commission.status)) {
            fail("COMMISSION_NOT_HOLDABLE");
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_commission_holds (
                commission_id,
                hold_type,
                reference_type,
                reference_id,
                reason,
                status,
                created_by_user_id
             ) VALUES (?, 'admin', 'admin', NULL, ?, 'active', ?)`,
            [commissionId, reason, actorUserId]
        );

        if (commission.status !== "on_hold") {
            await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = 'on_hold'
                 WHERE id = ?
                   AND status IN ('pending_protection', 'available')`,
                [commissionId]
            );
        }

        await auditService.writeAudit(conn, {
            actorUserId,
            action: "marketplace.commission.hold.created",
            entityType: "marketplace_commission_hold",
            entityId: String(result.insertId),
            oldData: {
                commissionStatus: commission.status
            },
            newData: {
                commissionId,
                holdType: "admin",
                reason,
                commissionStatus: "on_hold"
            },
            ipAddress: auditInfo.ipAddress || null,
            userAgent: auditInfo.userAgent || null
        });

        await conn.commit();

        return {
            holdId: result.insertId,
            commissionId,
            commissionStatus: "on_hold"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}


async function releaseAdminHold(holdId, actorUserId, data = {}, auditInfo = {}) {
    holdId = validId(holdId);
    actorUserId = validId(actorUserId);

    const releaseNote = String(data.releaseNote || "").trim();

    if (releaseNote.length > 5000) {
        fail("INVALID_COMMISSION_HOLD_RELEASE_NOTE");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Lock Hold
        const [holds] = await conn.execute(
            `SELECT *
             FROM marketplace_commission_holds
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [holdId]
        );

        if (!holds.length) {
            fail("COMMISSION_HOLD_NOT_FOUND");
        }

        const hold = holds[0];

        if (hold.hold_type !== "admin" || hold.reference_type !== "admin") {
            fail("COMMISSION_HOLD_NOT_ADMIN_OWNED");
        }

        if (hold.status !== "active") {
            fail("COMMISSION_HOLD_ALREADY_RELEASED");
        }

        // 2. Lock Commission
        const [commissions] = await conn.execute(
            `SELECT id, status, eligible_at, order_id, order_item_id
             FROM marketplace_commissions
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [hold.commission_id]
        );

        if (!commissions.length) {
            fail("COMMISSION_NOT_FOUND");
        }

        const commission = commissions[0];

        // 3. Lock and inspect Order
        const [orders] = await conn.execute(
            `SELECT id, order_status, payment_status
             FROM marketplace_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [commission.order_id]
        );

        if (!orders.length) {
            fail("COMMISSION_ORDER_NOT_FOUND");
        }

        const order = orders[0];

        // 4. Release this Admin Hold
        await conn.execute(
            `UPDATE marketplace_commission_holds
             SET status = 'released',
                 released_by_user_id = ?,
                 released_at = NOW(),
                 reason = CONCAT(
                    COALESCE(reason, ''),
                    CASE WHEN ? <> ''
                        THEN CONCAT('\nRelease note: ', ?)
                        ELSE ''
                    END
                 )
             WHERE id = ?
               AND status = 'active'`,
            [actorUserId, releaseNote, releaseNote, holdId]
        );

        // 5. Check remaining active Holds
        const [activeHolds] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_commission_holds
             WHERE commission_id = ?
               AND status = 'active'`,
            [commission.id]
        );

        const remainingActiveHolds = Number(activeHolds[0].total || 0);

        // 6. Check active Support Tickets
        const [activeTickets] = await conn.execute(
            `SELECT id
             FROM marketplace_support_tickets
             WHERE order_id = ?
               AND order_item_id = ?
               AND status IN (
                   'open',
                   'waiting_seller',
                   'waiting_buyer',
                   'under_review'
               )
             LIMIT 1
             FOR UPDATE`,
            [commission.order_id, commission.order_item_id]
        );

        // 7. Check order eligibility
        let releaseBlockedReason = null;

        if (remainingActiveHolds > 0) {
            releaseBlockedReason = "COMMISSION_HAS_ACTIVE_HOLDS";
        } else if (activeTickets.length > 0) {
            releaseBlockedReason = "COMMISSION_HAS_ACTIVE_TICKET";
        } else if (
            ["cancelled", "disputed", "refunded"].includes(order.order_status)
        ) {
            releaseBlockedReason = "COMMISSION_ORDER_NOT_ELIGIBLE";
        } else if (
            ["cancelled", "failed", "refunded", "partially_refunded"].includes(
                order.payment_status
            )
        ) {
            releaseBlockedReason = "COMMISSION_PAYMENT_NOT_ELIGIBLE";
        }

        let commissionStatus = commission.status;

        // 8. Restore status only when all conditions are valid
        if (
            !releaseBlockedReason &&
            commission.status === "on_hold"
        ) {
            await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = CASE
                    WHEN eligible_at IS NOT NULL
                         AND eligible_at <= NOW()
                        THEN 'available'
                    ELSE 'pending_protection'
                 END
                 WHERE id = ?
                   AND status = 'on_hold'`,
                [commission.id]
            );

            const [updated] = await conn.execute(
                `SELECT status
                 FROM marketplace_commissions
                 WHERE id = ?
                 LIMIT 1`,
                [commission.id]
            );

            commissionStatus = updated[0].status;
        }

        // 9. Audit
        await auditService.writeAudit(conn, {
            actorUserId,
            action: "marketplace.commission.hold.released",
            entityType: "marketplace_commission_hold",
            entityId: String(holdId),
            oldData: {
                holdStatus: "active",
                commissionStatus: commission.status
            },
            newData: {
                holdStatus: "released",
                releaseNote: releaseNote || null,
                remainingActiveHolds,
                activeSupportTicket: activeTickets.length > 0,
                orderStatus: order.order_status,
                paymentStatus: order.payment_status,
                releaseBlockedReason,
                commissionStatus
            },
            ipAddress: auditInfo.ipAddress || null,
            userAgent: auditInfo.userAgent || null
        });

        await conn.commit();

        return {
            holdId,
            commissionId: commission.id,
            holdStatus: "released",
            remainingActiveHolds,
            commissionStatus,
            releaseBlocked: Boolean(releaseBlockedReason),
            releaseBlockedReason
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

function buildCommissionFilters(params = {}, options = {}) {
    const filters = [];
    const values = [];
    const includeStatus = options.includeStatus !== false;

    const search = String(params.search || "").trim();
    const status = String(params.status || "").trim();
    const payoutMethod = params.payoutMethod ?? params.payout_method;
    const sellerId = params.sellerId ?? params.seller_id;
    const orderId = params.orderId ?? params.order_id;
    const dateFrom = params.dateFrom ?? params.date_from;
    const dateTo = params.dateTo ?? params.date_to;

    if (search) {
        filters.push(`(
            CAST(c.id AS CHAR) LIKE ?
            OR CAST(c.order_id AS CHAR) LIKE ?
            OR o.order_code LIKE ?
            OR oi.product_title LIKE ?
            OR s.display_name LIKE ?
            OR u.email LIKE ?
        )`);
        const keyword = `%${search}%`;
        values.push(keyword, keyword, keyword, keyword, keyword, keyword);
    }

    if (includeStatus && status) {
        const allowedStatuses = [
            "pending_protection",
            "available",
            "payout_requested",
            "paid",
            "on_hold",
            "partially_reversed",
            "reversed"
        ];
        if (allowedStatuses.includes(status)) {
            filters.push("c.status = ?");
            values.push(status);
        }
    }

    if (payoutMethod && ["credits", "cash"].includes(String(payoutMethod))) {
        filters.push("c.payout_method = ?");
        values.push(String(payoutMethod));
    }

    if (sellerId) {
        filters.push("c.seller_id = ?");
        values.push(validId(sellerId));
    }

    if (orderId) {
        filters.push("c.order_id = ?");
        values.push(validId(orderId));
    }

    if (dateFrom) {
        filters.push("c.created_at >= ?");
        values.push(`${String(dateFrom).slice(0, 10)} 00:00:00`);
    }

    if (dateTo) {
        filters.push("c.created_at <= ?");
        values.push(`${String(dateTo).slice(0, 10)} 23:59:59`);
    }

    return {
        where: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
        values
    };
}

const COMMISSION_LIST_SELECT = `
    SELECT
        c.*,
        o.order_code,
        o.order_status,
        o.payment_status,
        oi.product_title,
        COALESCE(s.display_name, CONCAT('Seller #', c.seller_id)) AS seller_name,
        u.email AS display_name
    FROM marketplace_commissions c
    LEFT JOIN marketplace_orders o
        ON o.id = c.order_id
    LEFT JOIN marketplace_order_items oi
        ON oi.id = c.order_item_id
       AND oi.order_id = c.order_id
    LEFT JOIN marketplace_sellers s
        ON s.id = c.seller_id
    LEFT JOIN users u
        ON u.id = c.seller_user_id
`;

async function getCommissions(params = {}) {
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { where, values } = buildCommissionFilters(params);

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_commissions c
         LEFT JOIN marketplace_orders o ON o.id = c.order_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id AND oi.order_id = c.order_id
         LEFT JOIN marketplace_sellers s ON s.id = c.seller_id
         LEFT JOIN users u ON u.id = c.seller_user_id
         ${where}`,
        values
    );

    const [items] = await db.execute(
        `${COMMISSION_LIST_SELECT}
         ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    const total = Number(countRows[0]?.total || 0);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getCommissionStatistics(params = {}) {
    // Không lọc theo status để thống kê vẫn hiển thị đầy đủ các trạng thái.
    const { where, values } = buildCommissionFilters(params, {
        includeStatus: false
    });

    const [rows] = await db.execute(
        `SELECT
            COUNT(*) AS total_count,
            COALESCE(SUM(c.seller_amount), 0) AS total_seller_amount,
            COALESCE(SUM(c.platform_amount), 0) AS total_platform_amount,
            COALESCE(SUM(c.reversed_amount), 0) AS total_reversed_amount,
            COALESCE(SUM(
                CASE WHEN c.status = 'pending_protection'
                    THEN c.seller_amount ELSE 0 END
            ), 0) AS pending_protection_amount,
            COALESCE(SUM(
                CASE WHEN c.status = 'available'
                    THEN c.seller_amount ELSE 0 END
            ), 0) AS available_amount,
            COALESCE(SUM(c.paid_amount), 0) AS paid_amount_total,
            COALESCE(SUM(
                CASE WHEN c.status = 'on_hold'
                    THEN c.seller_amount ELSE 0 END
            ), 0) AS on_hold_amount
         FROM marketplace_commissions c
         LEFT JOIN marketplace_orders o ON o.id = c.order_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id AND oi.order_id = c.order_id
         LEFT JOIN marketplace_sellers s ON s.id = c.seller_id
         LEFT JOIN users u ON u.id = c.seller_user_id
         ${where}`,
        values
    );

    const [byStatus] = await db.execute(
        `SELECT
            c.status,
            COUNT(*) AS count,
            COALESCE(SUM(c.seller_amount), 0) AS seller_amount
         FROM marketplace_commissions c
         LEFT JOIN marketplace_orders o ON o.id = c.order_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id AND oi.order_id = c.order_id
         LEFT JOIN marketplace_sellers s ON s.id = c.seller_id
         LEFT JOIN users u ON u.id = c.seller_user_id
         ${where}
         GROUP BY c.status
         ORDER BY count DESC`,
        values
    );

    return {
        summary: rows[0] || {},
        byStatus
    };
}

async function getCommissionDetail(id) {
    id = validId(id);

    const [commissions] = await db.execute(
        `${COMMISSION_LIST_SELECT}
         WHERE c.id = ?
         LIMIT 1`,
        [id]
    );

    if (!commissions.length) {
        fail("COMMISSION_NOT_FOUND");
    }

    const commission = commissions[0];

    const [holds] = await db.execute(
        `SELECT h.*
         FROM marketplace_commission_holds h
         WHERE h.commission_id = ?
         ORDER BY h.created_at DESC, h.id DESC`,
        [id]
    );

    const [tickets] = await db.execute(
        `SELECT
            t.id,
            t.ticket_code,
            t.order_id,
            t.order_item_id,
            t.buyer_user_id,
            t.seller_user_id,
            t.category,
            t.subject,
            t.status,
            t.resolution,
            t.assigned_admin_user_id,
            t.resolved_by_user_id,
            t.resolved_at,
            t.closed_at,
            t.created_at,
            t.updated_at
         FROM marketplace_support_tickets t
         WHERE t.order_id = ?
           AND (t.order_item_id = ? OR t.order_item_id IS NULL)
         ORDER BY t.created_at DESC, t.id DESC`,
        [commission.order_id, commission.order_item_id]
    );

    const [payouts] = await db.execute(
        `SELECT
            pi.id AS payout_item_id,
            pi.payout_request_id,
            pi.commission_id,
            pi.amount,
            pi.currency,
            pi.status AS payout_item_status,
            pi.created_at AS payout_item_created_at,
            pi.updated_at AS payout_item_updated_at,
            pr.request_code,
            pr.seller_id,
            pr.seller_user_id,
            pr.payout_method,
            pr.total_amount AS payout_total_amount,
            pr.currency AS payout_currency,
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
         ORDER BY pi.created_at DESC, pi.id DESC`,
        [id]
    );

    return {
        commission,
        holds,
        tickets,
        payouts,
        payoutItems: payouts
    };
}



module.exports = {
    getCommissionHolds,
    createAdminHold,
    releaseAdminHold,
    getCommissions,
    getCommissionStatistics,
    getCommissionDetail
};

