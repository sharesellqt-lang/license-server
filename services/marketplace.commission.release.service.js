
"use strict";

const db = require("../db");

const BATCH_SIZE = 100;
let isRunning = false;

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

async function releaseEligibleCommissions() {
    if (isRunning) {
        return { releasedCount: 0, skipped: true };
    }

    isRunning = true;

    let conn = null;
    let transactionStarted = false;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();
        transactionStarted = true;

        const ticketPlaceholders = ACTIVE_TICKET_STATUSES.map(() => "?").join(",");

        // Chỉ chọn commission đã thanh toán, hết bảo vệ,
        // không có Hold và không có Support Ticket đang hoạt động.
        const [rows] = await conn.execute(
            `SELECT c.id
             FROM marketplace_commissions c
             INNER JOIN marketplace_orders o
                ON o.id = c.order_id
             WHERE c.status = 'pending_protection'
               AND c.eligible_at IS NOT NULL
               AND c.eligible_at <= NOW()
               AND o.payment_status = 'paid'
               AND o.order_status NOT IN (
                   'cancelled',
                   'disputed',
                   'refunded'
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_commission_holds h
                   WHERE h.commission_id = c.id
                     AND h.status = 'active'
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_support_tickets t
                   WHERE (
                       t.order_item_id = c.order_item_id
                       OR (
                           t.order_item_id IS NULL
                           AND t.order_id = c.order_id
                       )
                   )
                   AND t.status IN (${ticketPlaceholders})
               )
             ORDER BY c.eligible_at ASC, c.id ASC
             LIMIT ?
             FOR UPDATE`,
            [...ACTIVE_TICKET_STATUSES, BATCH_SIZE]
        );

        if (!rows.length) {
            await conn.commit();
            transactionStarted = false;
            return { releasedCount: 0 };
        }

        const ids = rows.map(row => row.id);
        const placeholders = ids.map(() => "?").join(",");

        // Kiểm tra lại toàn bộ điều kiện tại thời điểm UPDATE.
        const [result] = await conn.execute(
            `UPDATE marketplace_commissions c
             INNER JOIN marketplace_orders o
                ON o.id = c.order_id
             SET c.status = 'available'
             WHERE c.status = 'pending_protection'
               AND c.id IN (${placeholders})
               AND c.eligible_at IS NOT NULL
               AND c.eligible_at <= NOW()
               AND o.payment_status = 'paid'
               AND o.order_status NOT IN (
                   'cancelled',
                   'disputed',
                   'refunded'
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_commission_holds h
                   WHERE h.commission_id = c.id
                     AND h.status = 'active'
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_support_tickets t
                   WHERE (
                       t.order_item_id = c.order_item_id
                       OR (
                           t.order_item_id IS NULL
                           AND t.order_id = c.order_id
                       )
                   )
                   AND t.status IN (${ticketPlaceholders})
               )`,
            [...ids, ...ACTIVE_TICKET_STATUSES]
        );

        await conn.commit();
        transactionStarted = false;

        return {
            releasedCount: result.affectedRows || 0
        };
    } catch (error) {
        if (conn && transactionStarted) {
            await conn.rollback();
        }

        throw error;
    } finally {
        if (conn) {
            conn.release();
        }

        isRunning = false;
    }
}

module.exports = {
    releaseEligibleCommissions
};
