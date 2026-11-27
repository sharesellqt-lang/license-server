"use strict";

const db = require("../db");
const auditService = require("./contributor.audit.service");

const TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review",
    "resolved",
    "rejected",
    "closed"
];

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

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

function pagination(value, fallback, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, max);
}

async function getTickets(params = {}) {
    const page = pagination(params.page, 1, 100000);
    const limit = pagination(params.limit, 20, 100);
    const offset = (page - 1) * limit;

    const filters = [];
    const values = [];

    if (params.status && TICKET_STATUSES.includes(params.status)) {
        filters.push("t.status = ?");
        values.push(params.status);
    }

    if (params.category) {
        filters.push("t.category = ?");
        values.push(String(params.category).trim());
    }

    if (params.search) {
        const search = `%${String(params.search).trim().slice(0, 100)}%`;
        filters.push("(t.ticket_code LIKE ? OR t.subject LIKE ?)");
        values.push(search, search);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_support_tickets t
         ${where}`,
        values
    );

    const [rows] = await db.execute(
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
            t.assigned_admin_user_id,
            t.resolved_by_user_id,
            t.resolved_at,
            t.closed_at,
            t.created_at,
            t.updated_at
         FROM marketplace_support_tickets t
         ${where}
         ORDER BY
            CASE WHEN t.status IN (
                'open', 'waiting_seller', 'waiting_buyer', 'under_review'
            ) THEN 0 ELSE 1 END,
            t.created_at DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    return {
        items: rows,
        pagination: {
            page,
            limit,
            total: Number(countRows[0].total || 0),
            totalPages: Math.ceil(Number(countRows[0].total || 0) / limit)
        }
    };
}

async function getTicketDetail(ticketId) {
    ticketId = validId(ticketId);

    const [rows] = await db.execute(
        `SELECT
            t.*,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.line_total,
            o.order_code,
            o.payment_status,
            o.order_status,
            c.id AS commission_id,
            c.status AS commission_status,
            c.eligible_at,
            c.seller_amount,
            c.platform_amount,
            c.payout_method,
            c.paid_amount,
            c.reversed_amount
         FROM marketplace_support_tickets t
         INNER JOIN marketplace_order_items oi
            ON oi.id = t.order_item_id
         INNER JOIN marketplace_orders o
            ON o.id = t.order_id
         LEFT JOIN marketplace_commissions c
            ON c.order_item_id = t.order_item_id
         WHERE t.id = ?
         LIMIT 1`,
        [ticketId]
    );

    if (!rows.length) fail("SUPPORT_TICKET_NOT_FOUND");

    return rows[0];
}


async function updateTicketStatus(ticketId, actorUserId, data, auditInfo = {}) {
    ticketId = validId(ticketId);
    actorUserId = validId(actorUserId);

    const status = String(data.status || "").trim();
    const resolution = String(data.resolution || "").trim();

    if (!TICKET_STATUSES.includes(status)) {
        fail("INVALID_TICKET_STATUS");
    }

    if (resolution.length > 10000) {
        fail("INVALID_TICKET_RESOLUTION");
    }

    if (["resolved", "rejected"].includes(status) && !resolution) {
        fail("TICKET_RESOLUTION_REQUIRED");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tickets] = await conn.execute(
            `SELECT *
             FROM marketplace_support_tickets
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticketId]
        );

        if (!tickets.length) fail("SUPPORT_TICKET_NOT_FOUND");

        const ticket = tickets[0];

        if (ticket.status === "closed" && status !== "closed") {
            fail("SUPPORT_TICKET_ALREADY_CLOSED");
        }

        const [commissions] = await conn.execute(
            `SELECT id, status, eligible_at
             FROM marketplace_commissions
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticket.order_item_id]
        );

        const isTerminal = ["resolved", "rejected", "closed"].includes(status);

        await conn.execute(
            `UPDATE marketplace_support_tickets
             SET status = ?,
                 resolution = CASE
                    WHEN ? <> '' THEN ?
                    ELSE resolution
                 END,
                 assigned_admin_user_id = COALESCE(
                    assigned_admin_user_id, ?
                 ),
                 resolved_by_user_id = CASE
                    WHEN ? IN ('resolved', 'rejected') THEN ?
                    ELSE resolved_by_user_id
                 END,
                 resolved_at = CASE
                    WHEN ? IN ('resolved', 'rejected')
                        THEN COALESCE(resolved_at, NOW())
                    ELSE resolved_at
                 END,
                 closed_at = CASE
                    WHEN ? = 'closed' THEN COALESCE(closed_at, NOW())
                    ELSE closed_at
                 END
             WHERE id = ?`,
            [
                status,
                resolution,
                resolution,
                actorUserId,
                status,
                actorUserId,
                status,
                status,
                ticketId
            ]
        );

        let commissionStatus = commissions.length
            ? commissions[0].status
            : null;

        let holdReleased = false;
        let activeHoldCount = 0;

        if (commissions.length) {
            const commissionId = commissions[0].id;

            if (!isTerminal) {
                // Đảm bảo ticket đang xử lý luôn có hold riêng.
                const [existingHolds] = await conn.execute(
                    `SELECT id
                     FROM marketplace_commission_holds
                     WHERE commission_id = ?
                       AND hold_type = 'support_ticket'
                       AND reference_type = 'support_ticket'
                       AND reference_id = ?
                       AND status = 'active'
                     LIMIT 1
                     FOR UPDATE`,
                    [commissionId, String(ticketId)]
                );

                if (!existingHolds.length) {
                    await conn.execute(
                        `INSERT INTO marketplace_commission_holds (
                            commission_id,
                            hold_type,
                            reference_type,
                            reference_id,
                            reason,
                            status,
                            created_by_user_id
                         ) VALUES (
                            ?, 'support_ticket', 'support_ticket',
                            ?, ?, 'active', ?
                         )`,
                        [
                            commissionId,
                            String(ticketId),
                            `Support ticket ${ticket.ticket_code}`,
                            actorUserId
                        ]
                    );
                }

                if (["pending_protection", "available"].includes(commissionStatus)) {
                    await conn.execute(
                        `UPDATE marketplace_commissions
                         SET status = 'on_hold'
                         WHERE id = ?
                           AND status IN ('pending_protection', 'available')`,
                        [commissionId]
                    );

                    commissionStatus = "on_hold";
                }
            } else {
                // Chỉ giải phóng hold của ticket đang được xử lý.
                const [releaseResult] = await conn.execute(
                    `UPDATE marketplace_commission_holds
                     SET status = 'released',
                         released_by_user_id = ?,
                         released_at = NOW()
                     WHERE commission_id = ?
                       AND hold_type = 'support_ticket'
                       AND reference_type = 'support_ticket'
                       AND reference_id = ?
                       AND status = 'active'`,
                    [actorUserId, commissionId, String(ticketId)]
                );

                holdReleased = releaseResult.affectedRows > 0;

                // Đếm tất cả hold còn hiệu lực của commission.
                const [holdRows] = await conn.execute(
                    `SELECT COUNT(*) AS total
                     FROM marketplace_commission_holds
                     WHERE commission_id = ?
                       AND status = 'active'`,
                    [commissionId]
                );

                activeHoldCount = Number(holdRows[0].total || 0);

                // Kiểm tra các ticket khác vẫn đang xử lý.
                const [activeTickets] = await conn.execute(
                    `SELECT id
                     FROM marketplace_support_tickets
                     WHERE order_item_id = ?
                       AND status IN (
                           'open',
                           'waiting_seller',
                           'waiting_buyer',
                           'under_review'
                       )
                     LIMIT 1
                     FOR UPDATE`,
                    [ticket.order_item_id]
                );

                // Chỉ giải phóng commission nếu thực sự giải phóng
                // hold của ticket này và không còn nguyên nhân giữ nào.
                if (
                    holdReleased &&
                    activeHoldCount === 0 &&
                    !activeTickets.length &&
                    commissionStatus === "on_hold"
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
                        [commissionId]
                    );

                    const [updated] = await conn.execute(
                        `SELECT status
                         FROM marketplace_commissions
                         WHERE id = ?
                         LIMIT 1`,
                        [commissionId]
                    );

                    if (updated.length) {
                        commissionStatus = updated[0].status;
                    }
                }
            }

            if (!isTerminal) {
                const [holdRows] = await conn.execute(
                    `SELECT COUNT(*) AS total
                     FROM marketplace_commission_holds
                     WHERE commission_id = ?
                       AND status = 'active'`,
                    [commissionId]
                );

                activeHoldCount = Number(holdRows[0].total || 0);
            }
        }

        await auditService.writeAudit(conn, {
            actorUserId,
            targetUserId: ticket.buyer_user_id,
            action: "marketplace.support_ticket.status_updated",
            entityType: "marketplace_support_ticket",
            entityId: String(ticketId),
            oldData: {
                status: ticket.status
            },
            newData: {
                status,
                resolution: resolution || null,
                commissionStatus,
                holdReleased,
                activeHoldCount
            },
            ipAddress: auditInfo.ipAddress || null,
            userAgent: auditInfo.userAgent || null
        });

        await conn.commit();

        return {
            ticketId,
            status,
            commissionStatus,
            holdReleased,
            activeHoldCount
        };
        } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            console.error(
                "[MarketplaceSupportAdmin] Rollback failed:",
                rollbackError
            );
        }

        throw error;
    } finally {
        conn.release();
    }
}


module.exports = {
    getTickets,
    getTicketDetail,
    updateTicketStatus
};