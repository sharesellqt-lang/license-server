
"use strict";

const db = require("../db");

const BATCH_SIZE = 100;
let isRunning = false;

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

        // Chỉ lấy commission đến hạn, không còn hold,
        // không còn khiếu nại và đơn hàng không có trạng thái rủi ro.
        const [rows] = await conn.execute(
            `SELECT c.id
             FROM marketplace_commissions c
             INNER JOIN marketplace_orders o
                ON o.id = c.order_id
             WHERE c.status = 'pending_protection'
               AND c.eligible_at IS NOT NULL
               AND c.eligible_at <= NOW()

               AND o.payment_status NOT IN (
                   'refunded',
                   'partially_refunded'
               )
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
                   AND t.status IN (
                       'open',
                       'waiting_seller',
                       'waiting_buyer',
                       'under_review'
                   )
               )

             ORDER BY c.eligible_at ASC, c.id ASC
             LIMIT ?
             FOR UPDATE`,
            [BATCH_SIZE]
        );

        if (!rows.length) {
            await conn.commit();
            transactionStarted = false;
            return { releasedCount: 0 };
        }

        const ids = rows.map(row => row.id);
        const placeholders = ids.map(() => "?").join(",");

        const [result] = await conn.execute(
            `UPDATE marketplace_commissions
             SET status = 'available'
             WHERE status = 'pending_protection'
               AND id IN (${placeholders})
               AND eligible_at <= NOW()
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_commission_holds h
                   WHERE h.commission_id = marketplace_commissions.id
                     AND h.status = 'active'
               )`,
            ids
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
