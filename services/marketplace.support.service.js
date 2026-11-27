
"use strict";

const crypto = require("crypto");
const db = require("../db");

const ALLOWED_CATEGORIES = [
    "product_not_working",
    "not_as_described",
    "delivery_issue",
    "installation_help",
    "seller_unresponsive",
    "copyright",
    "security_issue",
    "refund_request",
    "other"
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

function createTicketCode() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `MKT-${date}-${random}`;
}

async function createBuyerTicket(userId, orderItemId, data = {}) {
    userId = validId(userId);
    orderItemId = validId(orderItemId);

    const category = String(data.category || "").trim();
    const subject = String(data.subject || "").trim();
    const description = String(data.description || "").trim();

    if (!ALLOWED_CATEGORIES.includes(category)) fail("INVALID_TICKET_CATEGORY");
    if (!subject || subject.length > 255) fail("INVALID_TICKET_SUBJECT");
    if (!description || description.length > 10000) fail("INVALID_TICKET_DESCRIPTION");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [items] = await conn.execute(
            `SELECT
                oi.id,
                oi.order_id,
                oi.seller_user_id,
                o.buyer_user_id,
                o.payment_status
             FROM marketplace_order_items oi
             INNER JOIN marketplace_orders o ON o.id = oi.order_id
             WHERE oi.id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (!items.length) fail("ORDER_ITEM_NOT_FOUND");

        const item = items[0];

        if (Number(item.buyer_user_id) !== userId) {
            fail("ORDER_NOT_OWNED");
        }

        if (item.payment_status !== "paid") {
            fail("ORDER_NOT_PAID");
        }

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
            [orderItemId]
        );

        if (activeTickets.length) {
            fail("ACTIVE_TICKET_EXISTS");
        }

        const [commissions] = await conn.execute(
            `SELECT id, status
             FROM marketplace_commissions
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        const ticketCode = createTicketCode();

        const [ticketResult] = await conn.execute(
            `INSERT INTO marketplace_support_tickets (
                ticket_code,
                order_id,
                order_item_id,
                buyer_user_id,
                seller_user_id,
                category,
                subject,
                description,
                status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
            [
                ticketCode,
                item.order_id,
                orderItemId,
                userId,
                item.seller_user_id,
                category,
                subject,
                description
            ]
        );

        const ticketId = ticketResult.insertId;
        let commissionHeld = false;

        if (commissions.length) {
            const commission = commissions[0];

            if (
                ["pending_protection", "available", "on_hold"].includes(
                    commission.status
                )
            ) {
                await conn.execute(
                    `INSERT INTO marketplace_commission_holds (
                        commission_id,
                        hold_type,
                        reference_type,
                        reference_id,
                        reason,
                        status,
                        created_by_user_id
                    ) VALUES (?, 'support_ticket', 'support_ticket', ?, ?, 'active', ?)`,
                    [
                        commission.id,
                        String(ticketId),
                        `${category}: ${subject}`,
                        userId
                    ]
                );

                if (commission.status !== "on_hold") {
                    await conn.execute(
                        `UPDATE marketplace_commissions
                         SET status = 'on_hold'
                         WHERE id = ?
                           AND status IN ('pending_protection', 'available')`,
                        [commission.id]
                    );
                }

                commissionHeld = true;
            }
        }

        await conn.commit();

        return {
            ticketId,
            ticketCode,
            status: "open",
            commissionHeld
        };
       } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            console.error(
                "[MarketplaceSupport] Rollback failed:",
                rollbackError
            );
        }

        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    createBuyerTicket
};
