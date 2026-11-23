
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

        // Check automatic cancellation setting.
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

        // Lock expired orders.
        //
        // IMPORTANT:
        // Do not cancel an order if the buyer submitted a receipt
        // before or at the payment deadline and Finance has not
        // completed verification.
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
                     AND p.receipt_storage_key IS NOT NULL
                     AND p.submitted_at IS NOT NULL
                     AND p.submitted_at <= o.payment_deadline_at
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

        const orderIds = orders.map(order => Number(order.id));
        const placeholders = orderIds.map(() => "?").join(",");

        // Cancel remaining active payment attempts.
        await conn.execute(
            `UPDATE marketplace_order_payments
             SET status = 'cancelled',
                 updated_at = NOW()
             WHERE order_id IN (${placeholders})
               AND status IN ('pending', 'processing')`,
            orderIds
        );

        // Cancel expired orders.
        // Repeat conditions to protect against unexpected state changes.
        const [result] = await conn.execute(
            `UPDATE marketplace_orders
             SET payment_status = 'cancelled',
                 order_status = 'cancelled',
                 cancelled_at = COALESCE(cancelled_at, NOW()),
                 updated_at = NOW()
             WHERE id IN (${placeholders})
               AND payment_status IN ('pending', 'processing')
               AND order_status IN ('pending_payment', 'processing')
               AND payment_deadline_at IS NOT NULL
               AND payment_deadline_at <= NOW()`,
            orderIds
        );

        await conn.commit();
        committed = true;

        return {
            success: true,
            cancelledCount: result.affectedRows || 0,
            orderIds
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
