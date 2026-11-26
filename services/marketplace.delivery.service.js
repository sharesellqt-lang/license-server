
"use strict";

const db = require("../db");
const {
    createCommissionForDeliveredItem
} = require("./marketplace.commission.create.service");

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
        ["cancelled", "disputed", "refunded"].includes(item.order_status) ||
        ["cancelled", "refunded", "partially_refunded"].includes(item.payment_status)
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

async function consumeAuthorization(conn, authorizationId, userId, versionId) {
    const [result] = await conn.execute(
        `UPDATE marketplace_delivery_authorizations
         SET status = 'used',
             used_by_user_id = ?,
             used_at = NOW(),
             used_delivery_version_id = ?
         WHERE id = ?
           AND status = 'authorized'`,
        [userId, versionId, authorizationId]
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
    changeType,
    userId,
    content,
    files
) {

const [result] = await conn.execute(
    `INSERT INTO marketplace_delivery_versions (
        delivery_id,
        version_number,
        change_type,
        delivery_note,
        access_url,
        instructions,
        additional_data,
        change_reason,
        created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
        deliveryId,
        versionNumber,
        changeType,
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


async function createCommissionForPaidDelivery(conn, orderItemId) {
    orderItemId = validId(orderItemId);

    const [rows] = await conn.execute(
        `SELECT
            oi.id AS order_item_id,
            oi.order_id,
            oi.seller_id,
            oi.seller_user_id,
            oi.line_total,
            oi.currency,
            o.payment_status,
            o.order_status,
            d.id AS delivery_id,
            d.seller_rate,
            d.platform_rate,
            d.protection_started_at,
            d.protection_ends_at,
            TIMESTAMPDIFF(
                DAY,
                d.protection_started_at,
                d.protection_ends_at
            ) AS protection_days
         FROM marketplace_order_items oi
         INNER JOIN marketplace_orders o ON o.id = oi.order_id
         INNER JOIN marketplace_deliveries d
            ON d.order_item_id = oi.id
         WHERE oi.id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderItemId]
    );

    if (!rows.length) return null;

    const item = rows[0];

    if (item.payment_status !== "paid") return null;

    if (
        ["cancelled", "disputed", "refunded"].includes(item.order_status)
    ) {
        fail("ORDER_NOT_COMMISSIONABLE");
    }

    const sellerRate = Number(item.seller_rate);
    const platformRate = Number(item.platform_rate);
    const protectionDays = Number(item.protection_days);
    const commissionableAmount = Number(item.line_total);

    if (
        item.seller_rate == null ||
        item.platform_rate == null ||
        !Number.isFinite(sellerRate) ||
        !Number.isFinite(platformRate) ||
        sellerRate < 0 ||
        platformRate < 0 ||
        Math.round((sellerRate + platformRate) * 100) !== 10000 ||
        !Number.isInteger(protectionDays) ||
        protectionDays < 0 ||
        !item.protection_started_at ||
        !item.protection_ends_at ||
        !Number.isFinite(commissionableAmount) ||
        commissionableAmount < 0
    ) {
        fail("INVALID_DELIVERY_COMMISSION_SNAPSHOT");
    }

    let [commissions] = await conn.execute(
        `SELECT id, status
         FROM marketplace_commissions
         WHERE order_item_id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderItemId]
    );

    let commission = commissions[0] || null;

    if (!commission) {
        const sellerAmount = Math.round(
            commissionableAmount * sellerRate
        ) / 100;

        const platformAmount = Math.round(
            commissionableAmount * platformRate
        ) / 100;

        const [result] = await conn.execute(
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
             ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, 'pending_protection'
             )`,
            [
                item.order_id,
                orderItemId,
                item.seller_id,
                item.seller_user_id,
                commissionableAmount,
                item.currency,
                sellerRate,
                platformRate,
                sellerAmount,
                platformAmount,
                protectionDays,
                item.protection_started_at,
                item.protection_ends_at,
                item.protection_ends_at
            ]
        );

        commission = {
            id: result.insertId,
            status: "pending_protection"
        };
    }

    // Nếu có Support Ticket đang hoạt động, tạo Hold tương ứng.
    const [tickets] = await conn.execute(
        `SELECT
            id,
            buyer_user_id,
            category,
            subject
         FROM marketplace_support_tickets
         WHERE order_id = ?
           AND status IN (?, ?, ?, ?)
           AND (
                order_item_id = ?
                OR order_item_id IS NULL
           )
         ORDER BY id ASC
         FOR UPDATE`,
        [
            item.order_id,
            ...ACTIVE_TICKET_STATUSES,
            orderItemId
        ]
    );

    if (
        tickets.length &&
        ["pending_protection", "available", "on_hold", "payout_requested"]
            .includes(commission.status)
    ) {
        for (const ticket of tickets) {
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
                [commission.id, String(ticket.id)]
            );

            if (existingHolds.length) continue;

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
                    commission.id,
                    String(ticket.id),
                    `${ticket.category}: ${ticket.subject}`,
                    ticket.buyer_user_id
                ]
            );
        }

        // Không đổi payout_requested vì payout đã được yêu cầu.
        if (
            ["pending_protection", "available"].includes(commission.status)
        ) {
            await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = 'on_hold'
                 WHERE id = ?
                   AND status IN ('pending_protection', 'available')`,
                [commission.id]
            );

            commission.status = "on_hold";
        }
    }

    return {
        commissionId: commission.id,
        status: commission.status,
        created: commissions.length === 0
    };
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
                protection_ends_at,
                protection_days,
                seller_rate,
                platform_rate
             ) VALUES (
                ?, 'delivered', ?, ?, NOW(),
                DATE_ADD(NOW(), INTERVAL ? DAY),
                NOW(),
                DATE_ADD(NOW(), INTERVAL ? DAY),
                ?, ?, ?
             )`,
            [
                orderItemId,
                content.deliveryNote || null,
                userId,
                confirmationDays,
                protectionDays,
                protectionDays,
                sellerRate.toFixed(2),
                platformRate.toFixed(2)
            ]
        );

        const deliveryId = Number(deliveryResult.insertId);

        const [deliveryRows] = await conn.execute(
            `SELECT
                id,
                protection_days,
                protection_started_at,
                protection_ends_at,
                seller_rate,
                platform_rate
             FROM marketplace_deliveries
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [deliveryId]
        );

        if (!deliveryRows.length) fail("DELIVERY_CREATE_FAILED");

        const delivery = deliveryRows[0];

        const versionId = await createVersion(
            conn,
            deliveryId,
            1,
            "initial",
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

        let commissionResult = null;

        if (item.payment_status === "paid") {
            commissionResult = await createCommissionForDeliveredItem(
                conn,
                item,
                delivery,
                userId
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
            commissionId: commissionResult?.commissionId || null,
            commissionCreated: commissionResult?.created || false,
            orderStatus
        };
    } catch (error) {
        try {
            await conn.rollback();
        } catch (_) {}
        throw error;
    } finally {
        conn.release();
    }
}

async function updateDelivery(userId, deliveryId, data = {}) {
    return saveDeliveryVersion(userId, deliveryId, data, "update");
}

async function redeliver(userId, deliveryId, data = {}) {
    if (!String(data.changeReason || "").trim()) {
        fail("REDELIVERY_REASON_REQUIRED");
    }

    return saveDeliveryVersion(userId, deliveryId, data, "redelivery");
}
async function saveDeliveryVersion(
    userId,
    deliveryId,
    data = {},
    changeType = "update"
) {
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
                oi.seller_user_id,
                o.payment_status,
                o.order_status
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

        if (Number(delivery.seller_user_id) !== userId) {
            fail("DELIVERY_NOT_OWNED");
        }

        if (delivery.status !== "delivered" || delivery.buyer_confirmed_at) {
            fail("DELIVERY_NOT_EDITABLE");
        }

        await assertDeliverable(delivery);

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
            changeType,
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


async function getSellerDeliveries(userId, params = {}) {
    userId = validId(userId);

    const rawPage = Number(params.page ?? 1);
    const rawLimit = Number(params.limit ?? 20);

    const page = Number.isSafeInteger(rawPage) && rawPage > 0
        ? rawPage
        : 1;

    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
        ? Math.min(100, rawLimit)
        : 20;
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

    if (!["buyer", "automatic"].includes(method)) {
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
            ["cancelled", "refunded", "partially_refunded"].includes(item.payment_status)
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


async function getBuyerDeliveryDetail(userId, deliveryId) {
    userId = validId(userId);
    deliveryId = validId(deliveryId);

    const [rows] = await db.execute(
        `SELECT
            d.id,
            d.order_item_id,
            d.status,
            d.delivery_note,
            d.delivered_at,
            d.buyer_confirmed_at,
            d.buyer_confirmation_deadline_at,
            d.protection_started_at,
            d.protection_ends_at,
            oi.product_title,
            oi.product_type,
            oi.product_version,
            oi.quantity,
            o.id AS order_id,
            o.order_code
         FROM marketplace_deliveries d
         INNER JOIN marketplace_order_items oi
            ON oi.id = d.order_item_id
         INNER JOIN marketplace_orders o
            ON o.id = oi.order_id
         WHERE d.id = ?
           AND o.buyer_user_id = ?
           AND o.payment_status = 'paid'
           AND o.order_status NOT IN ('cancelled', 'refunded', 'disputed')
           AND d.status IN ('delivered', 'confirmed')
         LIMIT 1`,
        [deliveryId, userId]
    );

    if (!rows.length) fail("DELIVERY_NOT_FOUND");

    const delivery = rows[0];

    const [versions] = await db.execute(
        `SELECT
            v.id,
            v.version_number,
            v.change_type,
            v.delivery_note,
            v.access_url,
            v.instructions,
            v.additional_data,
            v.change_reason,
            v.created_at
         FROM marketplace_delivery_versions v
         WHERE v.delivery_id = ?
         ORDER BY v.version_number DESC`,
        [deliveryId]
    );

    if (versions.length) {
        const versionIds = versions.map(v => v.id);
        const placeholders = versionIds.map(() => "?").join(",");

        const [files] = await db.execute(
            `SELECT
                id,
                version_id,
                original_name,
                mime_type,
                file_size,
                created_at
             FROM marketplace_delivery_version_files
             WHERE version_id IN (${placeholders})
             ORDER BY id ASC`,
            versionIds
        );

        for (const version of versions) {
            version.files = files.filter(
                file => Number(file.version_id) === Number(version.id)
            );
        }
    }

    return {
        ...delivery,
        latest_version: versions[0] || null,
        versions
    };
}

module.exports = {
    createDelivery,
    updateDelivery,
    redeliver,
    getSellerDeliveries,
    getSellerDeliveryDetail,
    confirmDelivery,
    authorizeDelivery,
    revokeDeliveryAuthorization,
    getBuyerDeliveryDetail,
};
