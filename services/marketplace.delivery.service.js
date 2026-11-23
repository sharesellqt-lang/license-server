"use strict";

const db = require("../db");

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

function parseFileIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        fail("INVALID_DELIVERY_FILES");
    }

    const ids = value.map(validId);

    if (new Set(ids).size !== ids.length) {
        fail("DUPLICATE_DELIVERY_FILES");
    }

    return ids;
}

async function getSetting(conn, key, fallback) {
    const [rows] = await conn.execute(
        `SELECT setting_value
         FROM marketplace_settings
         WHERE setting_key = ?
         LIMIT 1`,
        [key]
    );

    return rows.length ? rows[0].setting_value : fallback;
}

async function createDelivery(userId, orderItemId, data = {}) {
    userId = validId(userId);
    orderItemId = validId(orderItemId);

    const fileIds = parseFileIds(data.fileIds);
    const deliveryNote = String(data.deliveryNote || "").trim();

    if (deliveryNote.length > 5000) {
        fail("DELIVERY_NOTE_TOO_LONG");
    }

    const conn = await db.getConnection();
    let committed = false;

    try {
        await conn.beginTransaction();

        // Seller phải đang hoạt động.
        const [sellers] = await conn.execute(
            `SELECT id, user_id, status
             FROM marketplace_sellers
             WHERE user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [userId]
        );

        if (!sellers.length || sellers[0].status !== "active") {
            fail("SELLER_NOT_ACTIVE");
        }

        const seller = sellers[0];

        // Khóa order item và order để tránh giao hàng đồng thời.
        const [items] = await conn.execute(
            `SELECT
                oi.id,
                oi.order_id,
                oi.product_id,
                oi.seller_id,
                oi.seller_user_id,
                oi.product_title,
                oi.product_version,
                oi.unit_price,
                oi.quantity,
                oi.line_total,
                o.buyer_user_id,
                o.payment_status,
                o.order_status,
                o.currency
             FROM marketplace_order_items oi
             INNER JOIN marketplace_orders o ON o.id = oi.order_id
             WHERE oi.id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (!items.length) fail("ORDER_ITEM_NOT_FOUND");

        const item = items[0];

        if (
            Number(item.seller_id) !== Number(seller.id) ||
            Number(item.seller_user_id) !== userId
        ) {
            fail("ORDER_ITEM_NOT_OWNED");
        }

        if (item.payment_status !== "paid") {
            fail("ORDER_NOT_PAID");
        }

        if (["cancelled", "disputed", "refunded"].includes(item.order_status)) {
            fail("ORDER_NOT_DELIVERABLE");
        }

        // Không cho tạo lần giao hàng thứ hai cho cùng order item.
        const [existing] = await conn.execute(
            `SELECT id
             FROM marketplace_deliveries
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (existing.length) fail("DELIVERY_ALREADY_EXISTS");

        // Các file phải thuộc đúng sản phẩm và có role delivery.
        const placeholders = fileIds.map(() => "?").join(",");

        const [files] = await conn.execute(
            `SELECT id
             FROM marketplace_product_files
             WHERE product_id = ?
               AND file_role = 'delivery'
               AND is_active = 1
               AND id IN (${placeholders})
             FOR UPDATE`,
            [item.product_id, ...fileIds]
        );

        if (files.length !== fileIds.length) {
            fail("INVALID_DELIVERY_FILES");
        }

        const protectionDays = Number(
            await getSetting(conn, "buyer_protection_days", "7")
        );

        const sellerRate = Number(
            await getSetting(conn, "seller_commission_rate", "80")
        );

        const platformRate = Number(
            await getSetting(conn, "platform_commission_rate", "20")
        );

        if (
            !Number.isInteger(protectionDays) ||
            protectionDays < 0 ||
            !Number.isFinite(sellerRate) ||
            !Number.isFinite(platformRate) ||
            sellerRate < 0 ||
            platformRate < 0 ||
            Math.round((sellerRate + platformRate) * 100) !== 10000
        ) {
            fail("INVALID_MARKETPLACE_COMMISSION_SETTINGS");
        }

        // Tạo lần giao hàng và chụp thời hạn bảo vệ tại thời điểm giao.
        const [deliveryResult] = await conn.execute(
            `INSERT INTO marketplace_deliveries (
                order_item_id,
                status,
                delivery_note,
                delivered_by_user_id,
                delivered_at,
                protection_started_at,
                protection_ends_at
             ) VALUES (
                ?, 'delivered', ?, ?, NOW(), NOW(),
                DATE_ADD(NOW(), INTERVAL ? DAY)
             )`,
            [orderItemId, deliveryNote || null, userId, protectionDays]
        );

        const deliveryId = deliveryResult.insertId;

        // Liên kết các file với đúng lần giao hàng.
        const values = fileIds.map(() => "(?, ?)").join(",");

        const insertParams = [];
        for (const fileId of fileIds) {
            insertParams.push(deliveryId, fileId);
        }

        await conn.execute(
            `INSERT INTO marketplace_delivery_files (
                delivery_id,
                product_file_id
             ) VALUES ${values}`,
            insertParams
        );

        // Chụp tỷ lệ và số tiền commission tại thời điểm giao hàng.
        const commissionableAmount = Number(item.line_total);
        if (!Number.isFinite(commissionableAmount) || commissionableAmount < 0) {
            fail("INVALID_COMMISSION_AMOUNT");
        }

        const sellerAmount = Math.round(
            commissionableAmount * sellerRate / 100
        );

        const platformAmount = Math.round(
            commissionableAmount * platformRate / 100
        );

        await conn.execute(
            `INSERT INTO marketplace_commissions (
                order_id,
                order_item_id,
                seller_id,
                seller_user_id,
                commissionable_amount,
                currency,
                seller_rate,
                platform_rate,
                seller_amount,
                platform_amount,
                protection_days,
                protection_started_at,
                protection_ends_at,
                eligible_at,
                status
             )
             SELECT
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                d.protection_started_at,
                d.protection_ends_at,
                d.protection_ends_at,
                'pending_protection'
             FROM marketplace_deliveries d
             WHERE d.id = ?`,
            [
                item.order_id,
                orderItemId,
                seller.id,
                userId,
                commissionableAmount,
                item.currency,
                sellerRate,
                platformRate,
                sellerAmount,
                platformAmount,
                protectionDays,
                deliveryId
            ]
        );

        // Cập nhật trạng thái đơn theo số order item đã giao.
        const [[counts]] = await conn.execute(
            `SELECT
                COUNT(*) AS total_items,
                SUM(
                    CASE WHEN d.status IN ('delivered', 'confirmed')
                    THEN 1 ELSE 0 END
                ) AS delivered_items
             FROM marketplace_order_items oi
             LEFT JOIN marketplace_deliveries d
                ON d.order_item_id = oi.id
             WHERE oi.order_id = ?`,
            [item.order_id]
        );

        const nextOrderStatus =
            Number(counts.total_items) > 0 &&
            Number(counts.delivered_items) >= Number(counts.total_items)
                ? "delivered"
                : "partially_delivered";

        await conn.execute(
            `UPDATE marketplace_orders
             SET order_status = ?
             WHERE id = ?
               AND payment_status = 'paid'`,
            [nextOrderStatus, item.order_id]
        );

        await conn.commit();
        committed = true;

        return {
            deliveryId,
            orderItemId,
            orderId: item.order_id,
            status: "delivered",
            fileCount: fileIds.length,
            protectionDays,
            orderStatus: nextOrderStatus
        };
    } catch (error) {
        if (!committed) {
            await conn.rollback();
        }
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    createDelivery
};