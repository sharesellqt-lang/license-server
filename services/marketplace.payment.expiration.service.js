
"use strict";

const db = require("../db");

const BATCH_SIZE = 100;
let isRunning = false;

function parseBoolean(value, defaultValue = false) {
    if (value === null || value === undefined) return defaultValue;

    return ["true", "1", "yes", "on"].includes(
        String(value).trim().toLowerCase()
    );
}

async function isAutoCancelEnabled(conn) {
    const [rows] = await conn.execute(
        `SELECT setting_value
         FROM marketplace_settings
         WHERE setting_key = 'payment_auto_cancel_enabled'
         LIMIT 1`
    );

    if (!rows.length) return false;

    return parseBoolean(rows[0].setting_value, false);
}

async function cancelExpiredOrders() {
    if (isRunning) {
        return {
            success: true,
            skipped: true,
            reason: "JOB_ALREADY_RUNNING",
            cancelledCount: 0,
            orderIds: []
        };
    }

    isRunning = true;

    let conn;
    let committed = false;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const enabled = await isAutoCancelEnabled(conn);

        if (!enabled) {
            await conn.rollback();

            return {
                success: true,
                skipped: true,
                reason: "AUTO_CANCEL_DISABLED",
                cancelledCount: 0,
                orderIds: []
            };
        }

        // Select expired orders.
        //
        // Never cancel an order when:
        // 1. Any payment attempt is still processing.
        // 2. Any delivery has already been created.
        //
        // Receipt submission time is intentionally not used here.
        // A processing payment must be resolved by Finance first.
        const [orders] = await conn.execute(
            `SELECT o.id
             FROM marketplace_orders o
             WHERE o.payment_deadline_at IS NOT NULL
               AND o.payment_deadline_at <= NOW()
               AND o.payment_status IN ('pending', 'processing')
               AND o.order_status IN ('pending_payment', 'processing')

               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_order_payments p
                   WHERE p.order_id = o.id
                     AND p.status = 'processing'
               )

               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_order_items oi
                   INNER JOIN marketplace_deliveries d
                       ON d.order_item_id = oi.id
                   WHERE oi.order_id = o.id
               )

             ORDER BY o.payment_deadline_at ASC, o.id ASC
             LIMIT ?
             FOR UPDATE`,
            [BATCH_SIZE]
        );

        if (!orders.length) {
            await conn.commit();
            committed = true;

            return {
                success: true,
                cancelledCount: 0,
                orderIds: []
            };
        }

        const cancelledOrderIds = [];

        // Recheck eligibility for each locked order before cancellation.
        for (const order of orders) {
            const orderId = Number(order.id);

            const [result] = await conn.execute(
                `UPDATE marketplace_orders o
                 SET o.payment_status = 'cancelled',
                     o.order_status = 'cancelled',
                     o.cancelled_at = COALESCE(o.cancelled_at, NOW()),
                     o.updated_at = NOW()
                 WHERE o.id = ?
                   AND o.payment_deadline_at IS NOT NULL
                   AND o.payment_deadline_at <= NOW()
                   AND o.payment_status IN ('pending', 'processing')
                   AND o.order_status IN ('pending_payment', 'processing')

                   AND NOT EXISTS (
                       SELECT 1
                       FROM marketplace_order_payments p
                       WHERE p.order_id = o.id
                         AND p.status = 'processing'
                   )

                   AND NOT EXISTS (
                       SELECT 1
                       FROM marketplace_order_items oi
                       INNER JOIN marketplace_deliveries d
                           ON d.order_item_id = oi.id
                       WHERE oi.order_id = o.id
                   )`,
                [orderId]
            );

            if (result.affectedRows > 0) {
                cancelledOrderIds.push(orderId);
            }
        }

        if (!cancelledOrderIds.length) {
            await conn.commit();
            committed = true;

            return {
                success: true,
                cancelledCount: 0,
                orderIds: []
            };
        }

        const placeholders = cancelledOrderIds.map(() => "?").join(",");

        // Cancel active payment attempts only after the corresponding
        // orders have successfully transitioned to cancelled.
        await conn.execute(
            `UPDATE marketplace_order_payments p
             INNER JOIN marketplace_orders o
                 ON o.id = p.order_id
             SET p.status = 'cancelled',
                 p.updated_at = NOW()
             WHERE p.order_id IN (${placeholders})
               AND p.status IN ('pending', 'processing')
               AND o.payment_status = 'cancelled'
               AND o.order_status = 'cancelled'`,
            cancelledOrderIds
        );

        // Revoke unused delivery authorizations.
        // Used authorizations are retained as historical records.
        await conn.execute(
            `UPDATE marketplace_delivery_authorizations a
             INNER JOIN marketplace_order_items oi
                 ON oi.id = a.order_item_id
             SET a.status = 'revoked',
                 a.revoked_by = NULL,
                 a.revoked_at = NOW(),
                 a.revocation_reason = ?,
                 a.updated_at = NOW()
             WHERE oi.order_id IN (${placeholders})
               AND a.status = 'authorized'`,
            [
                "Order tự động hủy do quá hạn thanh toán",
                ...cancelledOrderIds
            ]
        );

        await conn.commit();
        committed = true;

        return {
            success: true,
            cancelledCount: cancelledOrderIds.length,
            orderIds: cancelledOrderIds
        };

    } catch (err) {
        if (conn && !committed) {
            try {
                await conn.rollback();
            } catch (_) {}
        }

        console.error(
            "MARKETPLACE PAYMENT EXPIRATION ERROR:",
            err
        );

        throw err;

    } finally {
        if (conn) conn.release();
        isRunning = false;
    }
}

module.exports = {
    cancelExpiredOrders
};
