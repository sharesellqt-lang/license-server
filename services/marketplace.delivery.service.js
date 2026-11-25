
"use strict";

const db = require("../db");

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

const DELIVERY_STATUSES = [
    "pending",
    "delivered",
    "confirmed",
    "failed",
    "replaced",
    "refunded"
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

function parseFileIds(value) {
    if (value == null) return [];

    if (!Array.isArray(value) || value.length > 50) {
        fail("INVALID_DELIVERY_FILES");
    }

    const ids = value.map(validId);

    if (new Set(ids).size !== ids.length) {
        fail("DUPLICATE_DELIVERY_FILES");
    }

    return ids;
}

function parseContent(data = {}) {
    const result = {
        deliveryNote: String(data.deliveryNote || "").trim(),
        accessUrl: String(data.accessUrl || "").trim(),
        instructions: String(data.instructions || "").trim(),
        additionalData: data.additionalData == null
            ? null
            : JSON.stringify(data.additionalData),
        changeReason: String(data.changeReason || "").trim()
    };

    if (result.deliveryNote.length > 5000) fail("DELIVERY_NOTE_TOO_LONG");
    if (result.accessUrl.length > 5000) fail("ACCESS_URL_TOO_LONG");
    if (result.instructions.length > 10000) fail("INSTRUCTIONS_TOO_LONG");
    if (result.additionalData && result.additionalData.length > 50000) {
        fail("DELIVERY_DATA_TOO_LONG");
    }
    if (result.changeReason.length > 500) fail("CHANGE_REASON_TOO_LONG");

    return result;
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

async function getActiveSeller(conn, userId) {
    const [rows] = await conn.execute(
        `SELECT id, user_id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [userId]
    );

    if (!rows.length || rows[0].status !== "active") {
        fail("SELLER_NOT_ACTIVE");
    }

    return rows[0];
}

async function getOwnedOrderItem(conn, userId, orderItemId, lock = true) {
    const [rows] = await conn.execute(
        `SELECT
            oi.id,
            oi.order_id,
            oi.product_id,
            oi.seller_id,
            oi.seller_user_id,
            oi.product_title,
            oi.product_version,
            oi.product_type,
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
         ${lock ? "FOR UPDATE" : ""}`,
        [orderItemId]
    );

    if (!rows.length) fail("ORDER_ITEM_NOT_FOUND");

    const item = rows[0];

    if (Number(item.seller_user_id) !== userId) {
        fail("ORDER_ITEM_NOT_OWNED");
    }

    return item;
}

async function assertNoActiveTicket(conn, orderId, orderItemId) {
    const placeholders = ACTIVE_TICKET_STATUSES.map(() => "?").join(",");

    const [rows] = await conn.execute(
        `SELECT id
         FROM marketplace_support_tickets
         WHERE order_id = ?
           AND status IN (${placeholders})
           AND (
                order_item_id = ?
                OR order_item_id IS NULL
           )
         LIMIT 1
         FOR UPDATE`,
        [orderId, ...ACTIVE_TICKET_STATUSES, orderItemId]
    );

    if (rows.length) fail("ACTIVE_SUPPORT_TICKET");
}

async function assertDeliverable(item) {
    if (
        item.payment_status !== "paid" &&
        item.payment_status !== "partially_refunded"
    ) {
        fail("ORDER_NOT_PAID");
    }

    if (
        ["cancelled", "disputed", "refunded"].includes(item.order_status) ||
        item.payment_status === "partially_refunded"
    ) {
        fail("ORDER_NOT_DELIVERABLE");
    }
}

async function getAuthorizedException(conn, orderItemId) {
    const [rows] = await conn.execute(
        `SELECT id, order_item_id, status
         FROM marketplace_delivery_authorizations
         WHERE order_item_id = ?
           AND status = 'authorized'
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [orderItemId]
    );

    return rows[0] || null;
}

async function consumeAuthorization(
    conn,
    authorizationId,
    userId,
    versionId
) {
    const [result] = await conn.execute(
        `UPDATE marketplace_delivery_authorizations
         SET status = 'used',
             used_by_user_id = ?,
             used_at = NOW()
         WHERE id = ?
           AND status = 'authorized'`,
        [userId, authorizationId]
    );

    if (result.affectedRows !== 1) {
        fail("DELIVERY_AUTHORIZATION_ALREADY_USED");
    }
}

async function validateProductFiles(conn, productId, fileIds) {
    if (!fileIds.length) return [];

    const placeholders = fileIds.map(() => "?").join(",");

    const [files] = await conn.execute(
        `SELECT
            id,
            original_name,
            storage_key,
            mime_type,
            file_size,
            file_hash
         FROM marketplace_product_files
         WHERE product_id = ?
           AND file_role = 'delivery'
           AND is_active = 1
           AND id IN (${placeholders})
         FOR UPDATE`,
        [productId, ...fileIds]
    );

    if (files.length !== fileIds.length) {
        fail("INVALID_DELIVERY_FILES");
    }

    return files;
}

async function createVersion(
    conn,
    deliveryId,
    versionNumber,
    userId,
    content,
    files
) {
    const [result] = await conn.execute(
        `INSERT INTO marketplace_delivery_versions (
            delivery_id,
            version_number,
            delivery_note,
            access_url,
            instructions,
            additional_data,
            change_reason,
            created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            deliveryId,
            versionNumber,
            content.deliveryNote || null,
            content.accessUrl || null,
            content.instructions || null,
            content.additionalData,
            content.changeReason || null,
            userId
        ]
    );

    const versionId = result.insertId;

    if (files.length) {
        const values = files.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
        const params = [];

        for (const file of files) {
            params.push(
                versionId,
                file.original_name,
                file.storage_key,
                file.mime_type,
                file.file_size,
                file.file_hash,
                userId
            );
        }

        await conn.execute(
            `INSERT INTO marketplace_delivery_version_files (
                version_id,
                original_name,
                storage_key,
                mime_type,
                file_size,
                file_hash,
                uploaded_by_user_id
             ) VALUES ${values}`,
            params
        );
    }

    return versionId;
}

async function replaceCurrentFiles(conn, deliveryId, files) {
    await conn.execute(
        `DELETE FROM marketplace_delivery_files
         WHERE delivery_id = ?`,
        [deliveryId]
    );

    if (!files.length) return;

    const values = files.map(() => "(?, ?)").join(",");
    const params = [];

    for (const file of files) {
        params.push(deliveryId, file.id);
    }

    await conn.execute(
        `INSERT INTO marketplace_delivery_files (
            delivery_id,
            product_file_id
         ) VALUES ${values}`,
        params
    );
}

async function updateOrderDeliveryStatus(conn, orderId) {
    const [[counts]] = await conn.execute(
        `SELECT
            COUNT(*) AS total_items,
            SUM(
                CASE
                    WHEN d.status IN ('delivered', 'confirmed')
                    THEN 1 ELSE 0
                END
            ) AS delivered_items,
            SUM(
                CASE WHEN d.status = 'confirmed'
                THEN 1 ELSE 0 END
            ) AS confirmed_items
         FROM marketplace_order_items oi
         LEFT JOIN marketplace_deliveries d
            ON d.order_item_id = oi.id
         WHERE oi.order_id = ?`,
        [orderId]
    );

    const total = Number(counts.total_items || 0);
    const delivered = Number(counts.delivered_items || 0);
    const confirmed = Number(counts.confirmed_items || 0);

    let status = "paid";

    if (total > 0 && confirmed >= total) {
        status = "completed";
    } else if (total > 0 && delivered >= total) {
        status = "delivered";
    } else if (delivered > 0) {
        status = "partially_delivered";
    }

    await conn.execute(
        `UPDATE marketplace_orders
         SET order_status = ?
         WHERE id = ?
           AND payment_status = 'paid'
           AND order_status NOT IN ('cancelled', 'disputed', 'refunded')`,
        [status, orderId]
    );

    return status;
}

async function createDelivery(userId, orderItemId, data = {}) {
    userId = validId(userId);
    orderItemId = validId(orderItemId);

    const fileIds = parseFileIds(data.fileIds);
    const content = parseContent(data);

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        await getActiveSeller(conn, userId);

        const item = await getOwnedOrderItem(conn, userId, orderItemId);

        await assertDeliverable(item);
        await assertNoActiveTicket(conn, item.order_id, orderItemId);

        const [existing] = await conn.execute(
            `SELECT id
             FROM marketplace_deliveries
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (existing.length) fail("DELIVERY_ALREADY_EXISTS");

        let authorization = null;

        if (item.payment_status !== "paid") {
            authorization = await getAuthorizedException(conn, orderItemId);
            if (!authorization) fail("ORDER_NOT_PAID");
        }

        const files = await validateProductFiles(
            conn,
            item.product_id,
            fileIds
        );

        const protectionDays = Number(
            await getSetting(conn, "buyer_protection_days", "7")
        );

        const confirmationDays = Number(
            await getSetting(conn, "buyer_confirmation_days", "7")
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
            !Number.isInteger(confirmationDays) ||
            confirmationDays < 1 ||
            !Number.isFinite(sellerRate) ||
            !Number.isFinite(platformRate) ||
            sellerRate < 0 ||
            platformRate < 0 ||
            Math.round((sellerRate + platformRate) * 100) !== 10000
        ) {
            fail("INVALID_MARKETPLACE_SETTINGS");
        }

        const [deliveryResult] = await conn.execute(
            `INSERT INTO marketplace_deliveries (
                order_item_id,
                status,
                delivery_note,
                delivered_by_user_id,
                delivered_at,
                buyer_confirmation_deadline_at,
                protection_started_at,
                protection_ends_at
             ) VALUES (
                ?, 'delivered', ?, ?, NOW(),
                DATE_ADD(NOW(), INTERVAL ? DAY),
                NOW(),
                DATE_ADD(NOW(), INTERVAL ? DAY)
             )`,
            [
                orderItemId,
                content.deliveryNote || null,
                userId,
                confirmationDays,
                protectionDays
            ]
        );

        const deliveryId = deliveryResult.insertId;

        const versionId = await createVersion(
            conn,
            deliveryId,
            1,
            userId,
            content,
            files
        );

        await replaceCurrentFiles(conn, deliveryId, files);

        if (authorization) {
            await consumeAuthorization(
                conn,
                authorization.id,
                userId,
                versionId
            );
        }

        // Commission chỉ tạo một lần cho mỗi order item.
        const [[commission]] = await conn.execute(
            `SELECT id
             FROM marketplace_commissions
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (!commission) {
            const commissionableAmount = Number(item.line_total);

            if (
                !Number.isFinite(commissionableAmount) ||
                commissionableAmount < 0
            ) {
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
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    d.protection_started_at,
                    d.protection_ends_at,
                    d.protection_ends_at,
                    'pending_protection'
                 FROM marketplace_deliveries d
                 WHERE d.id = ?`,
                [
                    item.order_id,
                    orderItemId,
                    item.seller_id,
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
        }

        const orderStatus = await updateOrderDeliveryStatus(
            conn,
            item.order_id
        );

        await conn.commit();

        return {
            deliveryId,
            versionId,
            versionNumber: 1,
            orderItemId,
            orderId: item.order_id,
            status: "delivered",
            fileCount: files.length,
            protectionDays,
            confirmationDays,
            orderStatus
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function updateDelivery(userId, deliveryId, data = {}) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);

    const fileIds = parseFileIds(data.fileIds);
    const content = parseContent(data);

    if (!content.changeReason) fail("CHANGE_REASON_REQUIRED");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        await getActiveSeller(conn, userId);

        const [rows] = await conn.execute(
            `SELECT
                d.id,
                d.order_item_id,
                d.status,
                d.buyer_confirmed_at,
                oi.order_id,
                oi.product_id,
                oi.seller_user_id
             FROM marketplace_deliveries d
             INNER JOIN marketplace_order_items oi
                ON oi.id = d.order_item_id
             WHERE d.id = ?
             LIMIT 1
             FOR UPDATE`,
            [deliveryId]
        );

        if (!rows.length) fail("DELIVERY_NOT_FOUND");

        const delivery = rows[0];

        if (Number(delivery.seller_user_id) !== userId) {
            fail("DELIVERY_NOT_OWNED");
        }

        if (delivery.status !== "delivered" || delivery.buyer_confirmed_at) {
            fail("DELIVERY_NOT_EDITABLE");
        }

        await assertNoActiveTicket(
            conn,
            delivery.order_id,
            delivery.order_item_id
        );

        const [versions] = await conn.execute(
            `SELECT COALESCE(MAX(version_number), 0) AS current_version
             FROM marketplace_delivery_versions
             WHERE delivery_id = ?
             FOR UPDATE`,
            [deliveryId]
        );

        const nextVersion = Number(versions[0].current_version) + 1;

        const files = await validateProductFiles(
            conn,
            delivery.product_id,
            fileIds
        );

        const versionId = await createVersion(
            conn,
            deliveryId,
            nextVersion,
            userId,
            content,
            files
        );

        await conn.execute(
            `UPDATE marketplace_deliveries
             SET delivery_note = ?
             WHERE id = ?`,
            [content.deliveryNote || null, deliveryId]
        );

        await replaceCurrentFiles(conn, deliveryId, files);

        await conn.commit();

        return {
            deliveryId,
            versionId,
            versionNumber: nextVersion,
            status: "delivered",
            fileCount: files.length
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function redeliver(userId, deliveryId, data = {}) {
    // Redelivery sử dụng cơ chế versioning.
    // Lý do redelivery bắt buộc phải được cung cấp.
    if (!String(data.changeReason || "").trim()) {
        fail("REDELIVERY_REASON_REQUIRED");
    }

    return updateDelivery(userId, deliveryId, data);
}

async function getSellerDeliveries(userId, params = {}) {
    userId = validId(userId);

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions = ["oi.seller_user_id = ?"];
    const values = [userId];

    if (params.status) {
        if (!DELIVERY_STATUSES.includes(params.status)) {
            fail("INVALID_DELIVERY_STATUS");
        }

        conditions.push("d.status = ?");
        values.push(params.status);
    }

    if (params.search) {
        const search = String(params.search).trim().slice(0, 100);

        if (search) {
            conditions.push(
                `(o.order_code LIKE ?
                  OR oi.product_title LIKE ?
                  OR CAST(d.id AS CHAR) LIKE ?)`
            );

            values.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
    }

    const where = conditions.join(" AND ");
    const conn = await db.getConnection();

    try {
        const [[count]] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_deliveries d
             INNER JOIN marketplace_order_items oi
                ON oi.id = d.order_item_id
             INNER JOIN marketplace_orders o
                ON o.id = oi.order_id
             WHERE ${where}`,
            values
        );

        const [items] = await conn.execute(
            `SELECT
                d.id AS delivery_id,
                d.order_item_id,
                d.status,
                d.delivered_at,
                d.buyer_confirmed_at,
                d.buyer_confirmation_deadline_at,
                d.protection_ends_at,
                oi.order_id,
                oi.product_title,
                oi.product_type,
                oi.quantity,
                o.order_code,
                o.buyer_user_id
             FROM marketplace_deliveries d
             INNER JOIN marketplace_order_items oi
                ON oi.id = d.order_item_id
             INNER JOIN marketplace_orders o
                ON o.id = oi.order_id
             WHERE ${where}
             ORDER BY d.updated_at DESC, d.id DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return {
            items,
            pagination: {
                page,
                limit,
                total: Number(count.total),
                totalPages: Math.ceil(Number(count.total) / limit)
            }
        };
    } finally {
        conn.release();
    }
}

async function getSellerDeliveryDetail(userId, deliveryId) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);

    const conn = await db.getConnection();

    try {
        const [rows] = await conn.execute(
            `SELECT
                d.*,
                oi.order_id,
                oi.product_id,
                oi.product_title,
                oi.product_type,
                oi.product_version,
                oi.quantity,
                oi.line_total,
                o.order_code,
                o.buyer_user_id,
                o.currency
             FROM marketplace_deliveries d
             INNER JOIN marketplace_order_items oi
                ON oi.id = d.order_item_id
             INNER JOIN marketplace_orders o
                ON o.id = oi.order_id
             WHERE d.id = ?
               AND oi.seller_user_id = ?
             LIMIT 1`,
            [deliveryId, userId]
        );

        if (!rows.length) fail("DELIVERY_NOT_FOUND");

        const delivery = rows[0];

        const [versions] = await conn.execute(
            `SELECT *
             FROM marketplace_delivery_versions
             WHERE delivery_id = ?
             ORDER BY version_number DESC`,
            [deliveryId]
        );

        for (const version of versions) {
            const [files] = await conn.execute(
                `SELECT
                    id,
                    original_name,
                    storage_key,
                    mime_type,
                    file_size,
                    file_hash,
                    created_at
                 FROM marketplace_delivery_version_files
                 WHERE version_id = ?
                 ORDER BY id ASC`,
                [version.id]
            );

            version.files = files;
        }

        const [currentFiles] = await conn.execute(
            `SELECT
                df.id,
                pf.original_name,
                pf.storage_key,
                pf.mime_type,
                pf.file_size
             FROM marketplace_delivery_files df
             INNER JOIN marketplace_product_files pf
                ON pf.id = df.product_file_id
             WHERE df.delivery_id = ?`,
            [deliveryId]
        );

        return {
            ...delivery,
            currentFiles,
            versions
        };
    } finally {
        conn.release();
    }
}

async function confirmDelivery(deliveryId, actorUserId = null, method = "buyer") {
    deliveryId = validId(deliveryId);

    if (!["buyer", "automatic", "admin"].includes(method)) {
        fail("INVALID_CONFIRMATION_METHOD");
    }

    if (method !== "automatic") {
        actorUserId = validId(actorUserId);
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT
                d.id,
                d.order_item_id,
                d.status,
                d.buyer_confirmed_at,
                d.buyer_confirmation_deadline_at,
                oi.order_id,
                o.buyer_user_id
             FROM marketplace_deliveries d
             INNER JOIN marketplace_order_items oi
                ON oi.id = d.order_item_id
             INNER JOIN marketplace_orders o
                ON o.id = oi.order_id
             WHERE d.id = ?
             LIMIT 1
             FOR UPDATE`,
            [deliveryId]
        );

        if (!rows.length) fail("DELIVERY_NOT_FOUND");

        const delivery = rows[0];

        if (delivery.status !== "delivered" || delivery.buyer_confirmed_at) {
            fail("DELIVERY_NOT_CONFIRMABLE");
        }

        if (method === "buyer" &&
            Number(delivery.buyer_user_id) !== actorUserId) {
            fail("BUYER_NOT_AUTHORIZED");
        }

        if (method === "automatic") {
            const [deadline] = await conn.execute(
                `SELECT
                    buyer_confirmation_deadline_at <= NOW() AS is_due
                 FROM marketplace_deliveries
                 WHERE id = ?`,
                [deliveryId]
            );

            if (!deadline.length || !Number(deadline[0].is_due)) {
                fail("AUTO_CONFIRM_NOT_DUE");
            }
        }

        await assertNoActiveTicket(
            conn,
            delivery.order_id,
            delivery.order_item_id
        );

        await conn.execute(
            `UPDATE marketplace_deliveries
             SET status = 'confirmed',
                 buyer_confirmed_at = NOW(),
                 confirmation_method = ?
             WHERE id = ?
               AND status = 'delivered'
               AND buyer_confirmed_at IS NULL`,
            [method, deliveryId]
        );

        const orderStatus = await updateOrderDeliveryStatus(
            conn,
            delivery.order_id
        );

        await conn.commit();

        return {
            deliveryId,
            status: "confirmed",
            confirmationMethod: method,
            orderStatus
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function authorizeDelivery(adminUserId, orderItemId, reason) {
    adminUserId = validId(adminUserId);
    orderItemId = validId(orderItemId);
    reason = String(reason || "").trim();

    if (!reason || reason.length > 5000) {
        fail("INVALID_AUTHORIZATION_REASON");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [items] = await conn.execute(
            `SELECT
                oi.id,
                oi.order_id,
                oi.seller_user_id,
                o.payment_status,
                o.order_status
             FROM marketplace_order_items oi
             INNER JOIN marketplace_orders o ON o.id = oi.order_id
             WHERE oi.id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (!items.length) fail("ORDER_ITEM_NOT_FOUND");

        const item = items[0];

        if (item.payment_status === "paid") {
            fail("ORDER_ALREADY_PAID");
        }

        if (
            ["cancelled", "disputed", "refunded"].includes(item.order_status) ||
            item.payment_status === "cancelled" ||
            item.payment_status === "refunded"
        ) {
            fail("ORDER_NOT_DELIVERABLE");
        }

        const [existingDelivery] = await conn.execute(
            `SELECT id
             FROM marketplace_deliveries
             WHERE order_item_id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (existingDelivery.length) {
            fail("DELIVERY_ALREADY_EXISTS");
        }

        const [existingAuthorization] = await conn.execute(
            `SELECT id
             FROM marketplace_delivery_authorizations
             WHERE order_item_id = ?
               AND status = 'authorized'
             LIMIT 1
             FOR UPDATE`,
            [orderItemId]
        );

        if (existingAuthorization.length) {
            fail("ACTIVE_AUTHORIZATION_EXISTS");
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_delivery_authorizations (
                order_item_id,
                authorized_by,
                authorized_at,
                authorization_reason,
                status
             ) VALUES (?, ?, NOW(), ?, 'authorized')`,
            [orderItemId, adminUserId, reason]
        );

        await conn.commit();

        return {
            authorizationId: result.insertId,
            orderItemId,
            status: "authorized"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function revokeDeliveryAuthorization(
    adminUserId,
    authorizationId,
    reason
) {
    adminUserId = validId(adminUserId);
    authorizationId = validId(authorizationId);
    reason = String(reason || "").trim();

    if (!reason || reason.length > 5000) {
        fail("INVALID_REVOCATION_REASON");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(
            `UPDATE marketplace_delivery_authorizations
             SET status = 'revoked',
                 revoked_by = ?,
                 revoked_at = NOW(),
                 revocation_reason = ?
             WHERE id = ?
               AND status = 'authorized'`,
            [adminUserId, reason, authorizationId]
        );

        if (result.affectedRows !== 1) {
            fail("AUTHORIZATION_NOT_REVOCABLE");
        }

        await conn.commit();

        return {
            authorizationId,
            status: "revoked"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    createDelivery,
    updateDelivery,
    redeliver,
    getSellerDeliveries,
    getSellerDeliveryDetail,
    confirmDelivery,
    authorizeDelivery,
    revokeDeliveryAuthorization
};
