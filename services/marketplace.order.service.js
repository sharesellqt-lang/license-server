
"use strict";

const crypto = require("crypto");
const db = require("../db");

const PRODUCT_TYPES = [
    "template", "software", "utility", "design_resource",
    "digital_document", "course", "digital_service", "other"
];

const ORDER_STATUSES = [
    "pending_payment", "processing", "paid", "partially_delivered",
    "delivered", "completed", "cancelled", "disputed", "refunded"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value, code = "INVALID_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail(code);
    return id;
}

function pagination(params = {}) {
    const rawPage = Number(params.page);
    const rawLimit = Number(params.limit);

    const page = Number.isSafeInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 1000000)
        : 1;

    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 20;

    return { page, limit, offset: (page - 1) * limit };
}

function toCents(value) {
    const text = String(value ?? "").trim();

    if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
        fail("INVALID_PRODUCT_PRICE");
    }

    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function money(cents) {
    return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function makeOrderCode() {
    return `MKT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function normalizeSearch(value) {
    const search = String(value || "").trim();
    if (search.length > 150) fail("INVALID_SEARCH");
    return search;
}

// ========================================
// PUBLIC: LIST PUBLISHED PRODUCTS
// ========================================


async function getPublishedProducts(params = {}) {
    const conn = await db.getConnection();

    try {
        const { page, limit, offset } = pagination(params);
        const conditions = [
            "p.status = 'published'",
            "s.status = 'active'"
        ];
        const values = [];

        if (params.productType) {
            const productType = String(params.productType).trim();

            if (!PRODUCT_TYPES.includes(productType)) {
                fail("INVALID_PRODUCT_TYPE");
            }

            conditions.push("p.product_type = ?");
            values.push(productType);
        }

        const search = normalizeSearch(params.search);

        if (search) {
            conditions.push(`(
                p.title LIKE ?
                OR p.short_description LIKE ?
                OR p.description LIKE ?
            )`);

            const keyword = `%${search}%`;
            values.push(keyword, keyword, keyword);
        }

        const where = conditions.join(" AND ");

        const [countRows] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_products p
             INNER JOIN marketplace_sellers s ON s.id = p.seller_id
             WHERE ${where}`,
            values
        );

        const [rows] = await conn.execute(
            `SELECT
                p.id,
                p.seller_id,
                s.display_name AS seller_name,
                p.title,
                p.slug,
                p.short_description,
                p.product_type,
                p.price,
                p.currency,
                p.version,
                p.requirements,
                p.compatibility,
                p.published_at,
                (
                    SELECT CONCAT(
                        '/api/marketplace/products/',
                        p.id,
                        '/thumbnail'
                    )
                    FROM marketplace_product_files pf
                    WHERE pf.product_id = p.id
                      AND pf.file_role = 'thumbnail'
                      AND pf.is_active = 1
                      AND pf.mime_type IN (
                          'image/jpeg',
                          'image/png',
                          'image/webp'
                      )
                    ORDER BY pf.id DESC
                    LIMIT 1
                ) AS thumbnail_url
             FROM marketplace_products p
             INNER JOIN marketplace_sellers s ON s.id = p.seller_id
             WHERE ${where}
             ORDER BY p.published_at DESC, p.id DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        const total = Number(countRows[0].total || 0);

        return {
            items: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } finally {
        conn.release();
    }
}

// ========================================
// PUBLIC: GET PUBLISHED PRODUCT DETAIL
// ========================================


async function getPublishedProductDetail(productId) {
    productId = validId(productId, "PRODUCT_NOT_FOUND");

    const conn = await db.getConnection();

    try {
        const [rows] = await conn.execute(
            `SELECT
                p.id,
                p.seller_id,
                s.display_name AS seller_name,
                p.title,
                p.slug,
                p.short_description,
                p.description,
                p.product_type,
                p.price,
                p.currency,
                p.version,
                p.requirements,
                p.compatibility,
                p.license_terms,
                p.documentation,
                p.support_policy,
                p.update_policy,
                p.refund_policy,
                p.published_at,
                (
                    SELECT CONCAT(
                        '/api/marketplace/products/',
                        p.id,
                        '/thumbnail'
                    )
                    FROM marketplace_product_files pf
                    WHERE pf.product_id = p.id
                      AND pf.file_role = 'thumbnail'
                      AND pf.is_active = 1
                      AND pf.mime_type IN (
                          'image/jpeg',
                          'image/png',
                          'image/webp'
                      )
                    ORDER BY pf.id DESC
                    LIMIT 1
                ) AS thumbnail_url
             FROM marketplace_products p
             INNER JOIN marketplace_sellers s ON s.id = p.seller_id
             WHERE p.id = ?
               AND p.status = 'published'
               AND s.status = 'active'
             LIMIT 1`,
            [productId]
        );

        if (!rows.length) fail("PRODUCT_NOT_FOUND");

        const [demos] = await conn.execute(
            `SELECT
                id,
                demo_type,
                title,
                description,
                demo_url,
                file_id,
                sort_order
             FROM marketplace_product_demos
             WHERE product_id = ?
               AND is_active = 1
             ORDER BY sort_order ASC, id ASC`,
            [productId]
        );

        const [previews] = await conn.execute(
            `SELECT
                id,
                original_name,
                mime_type,
                file_size,
                version
             FROM marketplace_product_files
             WHERE product_id = ?
               AND file_role = 'preview'
               AND is_active = 1
             ORDER BY id DESC`,
            [productId]
        );

        return {
            ...rows[0],
            demos,
            previews
        };
    } finally {
        conn.release();
    }
}


// ========================================
// BUYER: CREATE ORDER + ITEMS + PAYMENT
// ========================================

async function createOrder(buyerUserId, data = {}) {
    buyerUserId = validId(buyerUserId, "INVALID_BUYER");

    if (
        !Array.isArray(data.items) ||
        data.items.length < 1 ||
        data.items.length > 50
    ) {
        fail("INVALID_ORDER_ITEMS");
    }

    const productIds = data.items.map(item => {
        if (item && item.quantity !== undefined && Number(item.quantity) !== 1) {
            fail("INVALID_ORDER_ITEMS");
        }

        return validId(item?.productId, "INVALID_PRODUCT_ID");
    });

    if (new Set(productIds).size !== productIds.length) {
        fail("DUPLICATE_ORDER_PRODUCT");
    }

    const sortedIds = [...productIds].sort((a, b) => a - b);

    let conn;
    let committed = false;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // Lock buyer row.
        const [buyerRows] = await conn.execute(
            `SELECT id
             FROM users
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [buyerUserId]
        );

        if (!buyerRows.length) fail("BUYER_NOT_FOUND");

        // Read configurable payment deadline.
        const [settings] = await conn.execute(
            `SELECT setting_value
             FROM marketplace_settings
             WHERE setting_key = 'payment_deadline_hours'
             LIMIT 1`,
        );

        const configuredHours = Number(settings[0]?.setting_value);
        const deadlineHours = Number.isInteger(configuredHours)
            ? Math.max(1, Math.min(168, configuredHours))
            : 24;

        const products = [];

        // Lock products in ascending ID order.
        for (const productId of sortedIds) {
            const [rows] = await conn.execute(
                `SELECT
                    p.id,
                    p.seller_id,
                    p.status,
                    p.title,
                    p.version,
                    p.product_type,
                    p.price,
                    p.currency,
                    p.license_terms,
                    s.user_id AS seller_user_id,
                    s.display_name AS seller_name,
                    s.status AS seller_status
                 FROM marketplace_products p
                 INNER JOIN marketplace_sellers s ON s.id = p.seller_id
                 WHERE p.id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [productId]
            );

            if (!rows.length) fail("PRODUCT_NOT_AVAILABLE");

            const product = rows[0];

            if (
                product.status !== "published" ||
                product.seller_status !== "active"
            ) {
                fail("PRODUCT_NOT_AVAILABLE");
            }

            if (Number(product.seller_user_id) === buyerUserId) {
                fail("CANNOT_BUY_OWN_PRODUCT");
            }

            if (product.currency !== "VND") {
                fail("UNSUPPORTED_CURRENCY");
            }

            products.push(product);
        }

        // Calculate totals using integer cents.
        let totalCents = 0n;

        const orderItems = products.map(product => {
            const unitCents = toCents(product.price);

            totalCents += unitCents;

            return {
                ...product,
                unitPrice: money(unitCents),
                lineTotal: money(unitCents)
            };
        });

        // Zero-total checkout is not supported by the current
        // manual bank-transfer payment flow.
        if (totalCents <= 0n) {
            fail("INVALID_ORDER_TOTAL");
        }

        const totalAmount = money(totalCents);
        const orderCode = makeOrderCode();

        const [orderResult] = await conn.execute(
            `INSERT INTO marketplace_orders (
                order_code,
                buyer_user_id,
                subtotal,
                discount_amount,
                total_amount,
                currency,
                payment_status,
                order_status,
                payment_deadline_at
             )
             VALUES (
                ?, ?, ?, '0.00', ?, 'VND',
                'pending', 'pending_payment',
                DATE_ADD(NOW(), INTERVAL ${deadlineHours} HOUR)
             )`,
            [
                orderCode,
                buyerUserId,
                totalAmount,
                totalAmount
            ]
        );

        const orderId = orderResult.insertId;

        // Create immutable purchase snapshots.
        for (const item of orderItems) {
            await conn.execute(
                `INSERT INTO marketplace_order_items (
                    order_id,
                    product_id,
                    seller_id,
                    seller_user_id,
                    product_title,
                    product_version,
                    product_type,
                    license_snapshot,
                    unit_price,
                    line_total,
                    quantity,
                    currency
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'VND')`,
                [
                    orderId,
                    item.id,
                    item.seller_id,
                    item.seller_user_id,
                    item.title,
                    item.version,
                    item.product_type,
                    item.license_terms,
                    item.unitPrice,
                    item.lineTotal
                ]
            );
        }

        // Create initial bank-transfer payment.
        const [paymentResult] = await conn.execute(
            `INSERT INTO marketplace_order_payments (
                order_id,
                payment_method,
                amount,
                currency,
                status,
                provider
             )
             VALUES (?, 'bank_transfer', ?, 'VND', 'pending', 'manual_bank_transfer')`,
            [orderId, totalAmount]
        );

        const [createdOrders] = await conn.execute(
            `SELECT
                id,
                order_code,
                total_amount,
                currency,
                payment_status,
                order_status,
                payment_deadline_at,
                created_at
             FROM marketplace_orders
             WHERE id = ?
             LIMIT 1`,
            [orderId]
        );

        await conn.commit();
        committed = true;

        return {
            ...createdOrders[0],
            items: orderItems.map(item => ({
                productId: item.id,
                productTitle: item.title,
                sellerName: item.seller_name,
                quantity: 1,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                currency: item.currency
            })),
            payment: {
                id: paymentResult.insertId,
                method: "bank_transfer",
                amount: totalAmount,
                currency: "VND",
                status: "pending"
            }
        };
    } catch (error) {
        if (conn && !committed) {
            try {
                await conn.rollback();
            } catch (_) {}
        }

        throw error;
    } finally {
        if (conn) conn.release();
    }
}

// ========================================
// BUYER: LIST MY ORDERS
// ========================================

async function getBuyerOrders(buyerUserId, params = {}) {
    buyerUserId = validId(buyerUserId, "INVALID_BUYER");

    const conn = await db.getConnection();

    try {
        const { page, limit, offset } = pagination(params);
        const conditions = ["o.buyer_user_id = ?"];
        const values = [buyerUserId];

        if (params.status) {
            const status = String(params.status).trim();

            if (!ORDER_STATUSES.includes(status)) {
                fail("INVALID_ORDER_STATUS");
            }

            conditions.push("o.order_status = ?");
            values.push(status);
        }

        const where = conditions.join(" AND ");

        const [countRows] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_orders o
             WHERE ${where}`,
            values
        );

        const [rows] = await conn.execute(
            `SELECT
                o.id,
                o.order_code,
                o.subtotal,
                o.discount_amount,
                o.total_amount,
                o.currency,
                o.payment_status,
                o.order_status,
                o.payment_deadline_at,
                o.paid_at,
                o.completed_at,
                o.created_at,
                COUNT(DISTINCT oi.id) AS item_count
             FROM marketplace_orders o
             LEFT JOIN marketplace_order_items oi ON oi.order_id = o.id
             WHERE ${where}
             GROUP BY o.id
             ORDER BY o.created_at DESC, o.id DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        const total = Number(countRows[0].total || 0);

        return {
            items: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } finally {
        conn.release();
    }
}

// ========================================
// BUYER: GET OWN ORDER DETAIL
// ========================================

async function getBuyerOrderDetail(buyerUserId, orderId) {
    buyerUserId = validId(buyerUserId, "INVALID_BUYER");
    orderId = validId(orderId, "INVALID_ORDER_ID");

    const conn = await db.getConnection();

    try {
        const [orders] = await conn.execute(
            `SELECT
                id,
                order_code,
                buyer_user_id,
                subtotal,
                discount_amount,
                total_amount,
                currency,
                payment_status,
                order_status,
                payment_deadline_at,
                paid_at,
                completed_at,
                cancelled_at,
                created_at
             FROM marketplace_orders
             WHERE id = ?
               AND buyer_user_id = ?
             LIMIT 1`,
            [orderId, buyerUserId]
        );

        if (!orders.length) fail("ORDER_NOT_FOUND");

        const [items] = await conn.execute(
            `SELECT
                oi.id,
                oi.product_id,
                oi.seller_id,
                oi.seller_user_id,
                oi.product_title,
                oi.product_version,
                oi.product_type,
                oi.license_snapshot,
                oi.unit_price,
                oi.line_total,
                oi.quantity,
                oi.currency,
                d.id AS delivery_id,
                d.status AS delivery_status,
                d.delivered_at,
                d.buyer_confirmed_at,
                d.protection_started_at,
                d.protection_ends_at
             FROM marketplace_order_items oi
             LEFT JOIN marketplace_deliveries d ON d.order_item_id = oi.id
             WHERE oi.order_id = ?
             ORDER BY oi.id ASC`,
            [orderId]
        );

        // Do not expose internal Finance verification notes to buyers.
        const [payments] = await conn.execute(
            `SELECT
                id,
                payment_method,
                amount,
                currency,
                status,
                transaction_reference,
                submitted_at,
                verified_at,
                paid_at,
                created_at,
                updated_at
             FROM marketplace_order_payments
             WHERE order_id = ?
             ORDER BY id DESC`,
            [orderId]
        );

        return {
            ...orders[0],
            items,
            payments
        };
    } finally {
        conn.release();
    }
}



// ========================================
// SELLER: GET SELLER ID
// ========================================

async function getSellerId(conn, sellerUserId) {
    const [rows] = await conn.execute(
        `SELECT id
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [sellerUserId]
    );

    if (!rows.length) fail("SELLER_NOT_FOUND");

    return Number(rows[0].id);
}

// ========================================
// SELLER: LIST MY ORDERS
// ========================================

async function getSellerOrders(sellerUserId, params = {}) {
    sellerUserId = validId(sellerUserId, "INVALID_USER_ID");

    const conn = await db.getConnection();

    try {
        const sellerId = await getSellerId(conn, sellerUserId);
        const { page, limit, offset } = pagination(params);

        const conditions = ["oi.seller_id = ?"];
        const values = [sellerId];

        if (params.status) {
            const status = String(params.status).trim();

            if (!ORDER_STATUSES.includes(status)) {
                fail("INVALID_ORDER_STATUS");
            }

            conditions.push("o.order_status = ?");
            values.push(status);
        }

        const search = normalizeSearch(params.search);

        if (search) {
            conditions.push(`(
                o.order_code LIKE ?
                OR u.email LIKE ?
                OR oi.product_title LIKE ?
            )`);

            const keyword = `%${search}%`;
            values.push(keyword, keyword, keyword);
        }

        const where = conditions.join(" AND ");

        const [countRows] = await conn.execute(
            `SELECT COUNT(DISTINCT o.id) AS total
             FROM marketplace_orders o
             INNER JOIN marketplace_order_items oi
                ON oi.order_id = o.id
             INNER JOIN users u
                ON u.id = o.buyer_user_id
             WHERE ${where}`,
            values
        );

        const [rows] = await conn.execute(
            `SELECT
                o.id,
                o.order_code,
                u.email AS buyer_email,
                o.currency,
                o.payment_status,
                o.order_status,
                o.payment_deadline_at,
                o.paid_at,
                o.created_at,
                COUNT(DISTINCT oi.id) AS item_count,
                SUM(oi.line_total) AS seller_total
             FROM marketplace_orders o
             INNER JOIN marketplace_order_items oi
                ON oi.order_id = o.id
             INNER JOIN users u
                ON u.id = o.buyer_user_id
             WHERE ${where}
             GROUP BY
                o.id,
                o.order_code,
                u.email,
                o.currency,
                o.payment_status,
                o.order_status,
                o.payment_deadline_at,
                o.paid_at,
                o.created_at
             ORDER BY o.created_at DESC, o.id DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
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
    } finally {
        conn.release();
    }
}

// ========================================
// SELLER: GET MY ORDER DETAIL
// ========================================

async function getSellerOrderDetail(sellerUserId, orderId) {
    sellerUserId = validId(sellerUserId, "INVALID_USER_ID");
    orderId = validId(orderId, "INVALID_ORDER_ID");

    const conn = await db.getConnection();

    try {
        const sellerId = await getSellerId(conn, sellerUserId);

        const [orders] = await conn.execute(
            `SELECT
                o.id,
                o.order_code,
                o.buyer_user_id,
                u.email AS buyer_email,
                o.currency,
                o.payment_status,
                o.order_status,
                o.payment_deadline_at,
                o.paid_at,
                o.created_at
             FROM marketplace_orders o
             INNER JOIN users u
                ON u.id = o.buyer_user_id
             WHERE o.id = ?
               AND EXISTS (
                   SELECT 1
                   FROM marketplace_order_items oi
                   WHERE oi.order_id = o.id
                     AND oi.seller_id = ?
               )
             LIMIT 1`,
            [orderId, sellerId]
        );

        if (!orders.length) fail("ORDER_NOT_FOUND");

        const [items] = await conn.execute(
            `SELECT
                oi.id,
                oi.product_id,
                oi.product_title,
                oi.product_version,
                oi.product_type,
                oi.unit_price,
                oi.line_total,
                oi.quantity,
                oi.currency,
                d.id AS delivery_id,
                d.status AS delivery_status,
                d.delivered_at,
                d.buyer_confirmed_at,
                d.protection_started_at,
                d.protection_ends_at
             FROM marketplace_order_items oi
             LEFT JOIN marketplace_deliveries d
                ON d.order_item_id = oi.id
             WHERE oi.order_id = ?
               AND oi.seller_id = ?
             ORDER BY oi.id ASC`,
            [orderId, sellerId]
        );

            const sellerTotalCents = items.reduce((sum, item) => {
            const value = String(item.line_total || "0.00");
            const [whole, fraction = ""] = value.split(".");
            return sum +
                BigInt(whole || "0") * 100n +
                BigInt(fraction.padEnd(2, "0").slice(0, 2));
        }, 0n);

        return {
            ...orders[0],
            items,
            seller_total: money(sellerTotalCents)
        };
    } finally {
        conn.release();
    }
}


module.exports = {
    getPublishedProducts,
    getPublishedProductDetail,
    createOrder,
    getBuyerOrders,
    getBuyerOrderDetail,
    getSellerOrders,
    getSellerOrderDetail
};