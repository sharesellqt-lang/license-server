
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

const SELLER_ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

const SELLER_TERMINAL_TICKET_STATUSES = [
    "resolved",
    "rejected",
    "closed"
];

function sellerPagination(params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 20));

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function sellerTicketFilters(params = {}) {
    const conditions = [];
    const values = [];

    if (params.status) {
        const statuses = String(params.status)
            .split(",")
            .map(s => s.trim())
            .filter(s =>
                SELLER_ACTIVE_TICKET_STATUSES.includes(s) ||
                SELLER_TERMINAL_TICKET_STATUSES.includes(s)
            );

        if (statuses.length) {
            conditions.push(`t.status IN (${statuses.map(() => "?").join(",")})`);
            values.push(...statuses);
        }
    }

    if (params.category) {
        const category = String(params.category).trim();

        if (ALLOWED_CATEGORIES.includes(category)) {
            conditions.push("t.category = ?");
            values.push(category);
        }
    }

    if (params.search) {
        const keyword = `%${String(params.search).trim()}%`;

        conditions.push(`(
            t.ticket_code LIKE ?
            OR t.subject LIKE ?
            OR oi.product_title LIKE ?
            OR o.order_code LIKE ?
        )`);

        values.push(keyword, keyword, keyword, keyword);
    }

    return {
        sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "",
        values
    };
}
async function getSellerTickets(userId, params = {}) {
    if (!validId(userId)) fail("INVALID_ID");

    const { page, limit, offset } = sellerPagination(params);
    const filters = sellerTicketFilters(params);

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o ON o.id = t.order_id
         WHERE t.seller_user_id = ? ${filters.sql}`,
        [userId, ...filters.values]
    );

    const [rows] = await db.execute(
        `SELECT
            t.id,
            t.ticket_code,
            t.order_id,
            t.order_item_id,
            t.buyer_user_id,
            t.category,
            t.subject,
            t.description,
            t.status,
            t.created_at,
            t.updated_at,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.line_total,
            oi.currency,
            o.order_code,
            (
                SELECT MAX(m.created_at)
                FROM marketplace_support_messages m
                WHERE m.ticket_id = t.id
                  AND m.message_type = 'reply'
            ) AS last_message_at
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o ON o.id = t.order_id
         WHERE t.seller_user_id = ? ${filters.sql}
         ORDER BY
            CASE
                WHEN t.status IN ('open','waiting_seller','waiting_buyer','under_review') THEN 0
                ELSE 1
            END,
            t.updated_at DESC,
            t.id DESC
         LIMIT ? OFFSET ?`,
        [userId, ...filters.values, limit, offset]
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

async function getSellerTicketDetail(userId, ticketId) {
    if (!validId(userId) || !validId(ticketId)) {
        fail("INVALID_ID");
    }

    const [rows] = await db.execute(
        `SELECT
            t.*,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.product_type,
            oi.line_total,
            oi.currency,
            o.order_code,
            o.payment_status,
            o.order_status,
            c.id AS commission_id,
            c.status AS commission_status,
            c.eligible_at AS commission_eligible_at
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o ON o.id = t.order_id
         LEFT JOIN marketplace_commissions c ON c.order_item_id = oi.id
         WHERE t.id = ?
           AND t.seller_user_id = ?
         LIMIT 1`,
        [ticketId, userId]
    );

    if (!rows.length) fail("SUPPORT_TICKET_NOT_FOUND");

    const ticket = rows[0];

    const [messages] = await db.execute(
        `SELECT
            id,
            ticket_id,
            sender_user_id,
            sender_role,
            message_type,
            message,
            created_at
         FROM marketplace_support_messages
         WHERE ticket_id = ?
           AND message_type IN ('reply','internal_note')
         ORDER BY id ASC`,
        [ticketId]
    );

    return {
        ticket,
        messages
    };
}

async function createSellerMessage(userId, ticketId, data = {}) {
    if (!validId(userId) || !validId(ticketId)) {
        fail("INVALID_ID");
    }

    const message = typeof data.message === "string"
        ? data.message.trim()
        : "";

    const messageType = data.message_type || "reply";

    if (!message || message.length > 10000) {
        fail("INVALID_TICKET_MESSAGE");
    }

    if (!["reply", "internal_note"].includes(messageType)) {
        fail("INVALID_TICKET_MESSAGE_TYPE");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tickets] = await conn.execute(
            `SELECT *
             FROM marketplace_support_tickets
             WHERE id = ?
               AND seller_user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticketId, userId]
        );

        if (!tickets.length) fail("SUPPORT_TICKET_NOT_FOUND");

        const ticket = tickets[0];

        if (SELLER_TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
            fail("SUPPORT_TICKET_MESSAGE_NOT_ALLOWED");
        }

        await conn.execute(
            `INSERT INTO marketplace_support_messages
                (ticket_id, sender_user_id, sender_role, message_type, message)
             VALUES (?, ?, 'seller', ?, ?)`,
            [ticketId, userId, messageType, message]
        );

        // Phản hồi công khai của Seller chuyển ticket sang trạng thái chờ Buyer.
        // Ghi chú nội bộ không làm thay đổi trạng thái.
        if (messageType === "reply" &&
            ["open", "waiting_seller", "waiting_buyer"].includes(ticket.status)) {
            await conn.execute(
                `UPDATE marketplace_support_tickets
                 SET status = 'waiting_buyer'
                 WHERE id = ?`,
                [ticketId]
            );
        }

        await conn.commit();

        return {
            ticketId: Number(ticketId),
            messageType,
            status: messageType === "reply" &&
                    ["open", "waiting_seller", "waiting_buyer"].includes(ticket.status)
                ? "waiting_buyer"
                : ticket.status
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function updateSellerTicketStatus(userId, ticketId, data = {}) {
    if (!validId(userId) || !validId(ticketId)) {
        fail("INVALID_ID");
    }

    const status = String(data.status || "").trim();

    const allowedTransitions = {
        open: ["waiting_seller"],
        waiting_seller: ["waiting_buyer"],
        waiting_buyer: ["waiting_seller"]
    };

    if (!Object.prototype.hasOwnProperty.call(allowedTransitions, status) &&
        !["waiting_seller", "waiting_buyer"].includes(status)) {
        fail("INVALID_TICKET_STATUS");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tickets] = await conn.execute(
            `SELECT *
             FROM marketplace_support_tickets
             WHERE id = ?
               AND seller_user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticketId, userId]
        );

        if (!tickets.length) fail("SUPPORT_TICKET_NOT_FOUND");

        const ticket = tickets[0];

        if (SELLER_TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
            fail("SUPPORT_TICKET_STATUS_INVALID");
        }

        const allowed = allowedTransitions[ticket.status] || [];

        if (!allowed.includes(status)) {
            fail("SUPPORT_TICKET_STATUS_INVALID");
        }

        await conn.execute(
            `UPDATE marketplace_support_tickets
             SET status = ?
             WHERE id = ?`,
            [status, ticketId]
        );

        await conn.commit();

        return {
            ticketId: Number(ticketId),
            oldStatus: ticket.status,
            status
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}


async function createAdminMessage(adminUserId, ticketId, data = {}) {
    if (!validId(adminUserId) || !validId(ticketId)) {
        fail("INVALID_ID");
    }

    const message = typeof data.message === "string"
        ? data.message.trim()
        : "";

    const messageType = data.message_type || "reply";

    if (!message || message.length > 10000) {
        fail("INVALID_TICKET_MESSAGE");
    }

    if (!["reply", "internal_note"].includes(messageType)) {
        fail("INVALID_TICKET_MESSAGE_TYPE");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tickets] = await conn.execute(
            `SELECT id, status
             FROM marketplace_support_tickets
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticketId]
        );

        if (!tickets.length) {
            fail("SUPPORT_TICKET_NOT_FOUND");
        }

        const ticket = tickets[0];

        if (SELLER_TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
            fail("SUPPORT_TICKET_MESSAGE_NOT_ALLOWED");
        }

        await conn.execute(
            `INSERT INTO marketplace_support_messages
                (ticket_id, sender_user_id, sender_role, message_type, message)
             VALUES (?, ?, 'admin', ?, ?)`,
            [ticketId, adminUserId, messageType, message]
        );

        await conn.commit();

        return {
            ticketId: Number(ticketId),
            senderRole: "admin",
            messageType,
            status: ticket.status
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}


async function getBuyerTickets(userId, params = {}) {
    if (!validId(userId)) fail("INVALID_ID");

    const { page, limit, offset } = sellerPagination(params);
    const filters = sellerTicketFilters(params);

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o ON o.id = t.order_id
         WHERE t.buyer_user_id = ? ${filters.sql}`,
        [userId, ...filters.values]
    );

    const [rows] = await db.execute(
        `SELECT
            t.id,
            t.ticket_code,
            t.order_id,
            t.order_item_id,
            t.seller_user_id,
            t.category,
            t.subject,
            t.description,
            t.status,
            t.created_at,
            t.updated_at,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.line_total,
            oi.currency,
            o.order_code,
            (
                SELECT MAX(m.created_at)
                FROM marketplace_support_messages m
                WHERE m.ticket_id = t.id
                  AND m.message_type = 'reply'
            ) AS last_message_at
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o ON o.id = t.order_id
         WHERE t.buyer_user_id = ? ${filters.sql}
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT ? OFFSET ?`,
        [userId, ...filters.values, limit, offset]
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

async function getBuyerTicketDetail(userId, ticketId) {
    userId = validId(userId);
    ticketId = validId(ticketId);

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
            t.description,
            t.status,
            t.created_at,
            t.updated_at,
            oi.product_id,
            oi.product_title,
            oi.product_version,
            oi.product_type,
            oi.line_total,
            oi.currency,
            o.order_code,
            o.payment_status,
            o.order_status
         FROM marketplace_support_tickets t
         LEFT JOIN marketplace_order_items oi
            ON oi.id = t.order_item_id
         LEFT JOIN marketplace_orders o
            ON o.id = t.order_id
         WHERE t.id = ?
           AND t.buyer_user_id = ?
         LIMIT 1`,
        [ticketId, userId]
    );

    if (!rows.length) {
        fail("SUPPORT_TICKET_NOT_FOUND");
    }

    const [messages] = await db.execute(
        `SELECT
            id,
            ticket_id,
            sender_user_id,
            sender_role,
            message,
            created_at
         FROM marketplace_support_messages
         WHERE ticket_id = ?
           AND message_type = 'reply'
         ORDER BY id ASC`,
        [ticketId]
    );

    return {
        ticket: rows[0],
        messages
    };
}

async function createBuyerMessage(userId, ticketId, data = {}) {
    if (!validId(userId) || !validId(ticketId)) {
        fail("INVALID_ID");
    }

    const message = typeof data.message === "string"
        ? data.message.trim()
        : "";

    if (!message || message.length > 10000) {
        fail("INVALID_TICKET_MESSAGE");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tickets] = await conn.execute(
            `SELECT id, status
             FROM marketplace_support_tickets
             WHERE id = ?
               AND buyer_user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [ticketId, userId]
        );

        if (!tickets.length) {
            fail("SUPPORT_TICKET_NOT_FOUND");
        }

        const ticket = tickets[0];

        if (SELLER_TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
            fail("SUPPORT_TICKET_MESSAGE_NOT_ALLOWED");
        }

        await conn.execute(
            `INSERT INTO marketplace_support_messages
                (ticket_id, sender_user_id, sender_role, message_type, message)
             VALUES (?, ?, 'buyer', 'reply', ?)`,
            [ticketId, userId, message]
        );

        let nextStatus = ticket.status;

        if (ticket.status === "waiting_buyer") {
            nextStatus = "waiting_seller";

            await conn.execute(
                `UPDATE marketplace_support_tickets
                 SET status = 'waiting_seller'
                 WHERE id = ?`,
                [ticketId]
            );
        }

        await conn.commit();

        return {
            ticketId: Number(ticketId),
            senderRole: "buyer",
            status: nextStatus
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    createBuyerTicket,
    getSellerTickets,
    getSellerTicketDetail,
    createSellerMessage,
    updateSellerTicketStatus,
    createAdminMessage,
    getBuyerTickets,
    getBuyerTicketDetail,
    createBuyerMessage
};