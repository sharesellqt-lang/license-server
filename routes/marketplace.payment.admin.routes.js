
"use strict";

const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");

const { writeAudit } = require("../services/contributor.audit.service");
const { sendReceiptFile } = require("../services/marketplace.receipt.service");
const {
    createCommissionForDeliveredItem
} = require("../services/marketplace.commission.create.service");

router.use(auth);
router.use(requireContributorPermission("marketplace.payment.view"));

const ALLOWED_STATUSES = [
    "pending",
    "processing",
    "paid",
    "failed",
    "cancelled",
    "refunded"
];

function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toCents(value) {
    const input = String(value ?? "").trim();

    if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(input)) {
        return null;
    }

    const [whole, fraction = ""] = input.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function pagination(query = {}) {
    const rawPage = Number(query.page);
    const rawLimit = Number(query.limit);

    const page = Number.isSafeInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 1000000)
        : 1;

    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 20;

    return { page, limit, offset: (page - 1) * limit };
}

function rollbackResponse(res, status, code, message, data) {
    const response = { success: false, code, message };
    if (data !== undefined) response.data = data;
    return res.status(status).json(response);
}

// ========================================
// GET: LIST PAYMENTS
// GET /api/marketplace/admin/payments
// ========================================

router.get("/payments", async (req, res) => {
    try {
        const status = String(req.query.status || "").trim();
        const search = String(req.query.search || "").trim();

        const { page, limit, offset } = pagination(req.query);

        if (status && !ALLOWED_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Trạng thái thanh toán không hợp lệ."
            });
        }

        if (search.length > 150) {
            return res.status(400).json({
                success: false,
                message: "Từ khóa tìm kiếm không được vượt quá 150 ký tự."
            });
        }

        const conditions = [];
        const params = [];

        if (status) {
            conditions.push("p.status = ?");
            params.push(status);
        } else {
            conditions.push("p.status IN ('pending', 'processing')");
        }

        if (search) {
            const keyword = `%${search}%`;

            conditions.push(`(
                o.order_code LIKE ?
                OR CAST(o.id AS CHAR) LIKE ?
                OR CAST(p.id AS CHAR) LIKE ?
                OR u.email LIKE ?
                OR p.transaction_reference LIKE ?
                OR p.provider_transaction_id LIKE ?
            )`);

            params.push(
                keyword,
                keyword,
                keyword,
                keyword,
                keyword,
                keyword
            );
        }

        const whereSQL = `WHERE ${conditions.join(" AND ")}`;

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_order_payments p
             INNER JOIN marketplace_orders o ON o.id = p.order_id
             INNER JOIN users u ON u.id = o.buyer_user_id
             ${whereSQL}`,
            params
        );

        const [rows] = await db.execute(
            `SELECT
                p.id AS payment_id,
                p.order_id,
                o.order_code,
                o.buyer_user_id,
                u.email AS buyer_email,
                o.total_amount AS order_total,
                o.currency,
                o.payment_status AS order_payment_status,
                o.order_status,
                o.payment_deadline_at,
                p.payment_method,
                p.amount AS payment_amount,
                p.status AS payment_status,
                p.transaction_reference,
                p.provider_transaction_id,
                (p.receipt_storage_key IS NOT NULL) AS has_receipt,
                p.submitted_at,
                p.verified_at,
                p.verified_by_user_id,
                p.created_at,
                p.updated_at
             FROM marketplace_order_payments p
             INNER JOIN marketplace_orders o ON o.id = p.order_id
             INNER JOIN users u ON u.id = o.buyer_user_id
             ${whereSQL}
             ORDER BY
                CASE WHEN p.status = 'processing' THEN 0 ELSE 1 END,
                p.submitted_at ASC,
                p.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const total = Number(countRows[0].total || 0);

        return res.json({
            success: true,
            data: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error("MARKETPLACE FINANCE PAYMENT LIST ERROR:", err);

        return res.status(500).json({
            success: false,
            message: "Không thể tải danh sách thanh toán."
        });
    }
});

// ========================================
// GET: PAYMENT DETAIL
// GET /api/marketplace/admin/payments/:id
// ========================================

router.get("/payments/:id", async (req, res) => {
    try {
        const paymentId = validId(req.params.id);

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                message: "Payment ID không hợp lệ."
            });
        }

        const [payments] = await db.execute(
            `SELECT
                p.id AS payment_id,
                p.order_id,
                o.order_code,
                o.buyer_user_id,
                u.email AS buyer_email,
                o.subtotal,
                o.discount_amount,
                o.total_amount AS order_total,
                o.currency,
                o.payment_status AS order_payment_status,
                o.order_status,
                o.payment_deadline_at,
                p.payment_method,
                p.amount AS payment_amount,
                p.currency AS payment_currency,
                p.status AS payment_status,
                p.provider,
                p.provider_transaction_id,
                p.transaction_reference,
                (p.receipt_storage_key IS NOT NULL) AS has_receipt,
                p.submitted_at,
                p.verified_by_user_id,
                p.verified_at,
                p.verification_note,
                p.paid_at,
                p.created_at,
                p.updated_at
             FROM marketplace_order_payments p
             INNER JOIN marketplace_orders o ON o.id = p.order_id
             INNER JOIN users u ON u.id = o.buyer_user_id
             WHERE p.id = ?
             LIMIT 1`,
            [paymentId]
        );

        if (!payments.length) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy khoản thanh toán."
            });
        }

        const [items] = await db.execute(
            `SELECT
                id,
                product_id,
                seller_id,
                seller_user_id,
                product_title,
                product_version,
                product_type,
                unit_price,
                quantity,
                line_total,
                currency
             FROM marketplace_order_items
             WHERE order_id = ?
             ORDER BY id ASC`,
            [payments[0].order_id]
        );

        return res.json({
            success: true,
            data: {
                payment: payments[0],
                orderItems: items
            }
        });
    } catch (err) {
        console.error("MARKETPLACE FINANCE PAYMENT DETAIL ERROR:", err);

        return res.status(500).json({
            success: false,
            message: "Không thể tải chi tiết thanh toán."
        });
    }
});

// ========================================
// POST: VERIFY PAYMENT
// POST /api/marketplace/admin/payments/:id/verify
// ========================================

router.post(
    "/payments/:id/verify",
    requireContributorPermission("marketplace.payment.verify"),
    async (req, res) => {
        let conn;
        let committed = false;

        try {
            const paymentId = validId(req.params.id);
            const actorUserId = validId(req.user?.id);

            if (!paymentId || !actorUserId) {
                return res.status(400).json({
                    success: false,
                    message: "Thông tin Payment hoặc Finance không hợp lệ."
                });
            }

            const body = req.body || {};
            const decision = String(body.decision || "").trim();
            const note = String(body.note || "").trim();

            if (!["paid", "failed"].includes(decision)) {
                return res.status(400).json({
                    success: false,
                    message: "Quyết định phải là paid hoặc failed."
                });
            }

            if (note.length > 5000) {
                return res.status(400).json({
                    success: false,
                    message: "Ghi chú không được vượt quá 5000 ký tự."
                });
            }

            if (decision === "failed" && !note) {
                return res.status(400).json({
                    success: false,
                    message: "Vui lòng nhập lý do từ chối thanh toán."
                });
            }

            const transactionId = String(
                body.providerTransactionId || ""
            ).trim();

            if (decision === "paid") {
                if (!transactionId || transactionId.length > 255) {
                    return res.status(400).json({
                        success: false,
                        message: "Cần nhập mã giao dịch thực tế từ ngân hàng."
                    });
                }

                if (body.receivedAmount === undefined) {
                    return res.status(400).json({
                        success: false,
                        message: "Cần nhập số tiền thực tế ngân hàng đã nhận."
                    });
                }
            }

            conn = await db.getConnection();
            await conn.beginTransaction();

            // Resolve the order before locking.
            const [paymentRefs] = await conn.execute(
                `SELECT order_id
                 FROM marketplace_order_payments
                 WHERE id = ?
                 LIMIT 1`,
                [paymentId]
            );

            if (!paymentRefs.length) {
                await conn.rollback();

                return res.status(404).json({
                    success: false,
                    message: "Không tìm thấy khoản thanh toán."
                });
            }

            const orderId = Number(paymentRefs[0].order_id);

            // Lock order first.
            const [orders] = await conn.execute(
                `SELECT
                    id,
                    order_code,
                    total_amount,
                    currency,
                    payment_status,
                    order_status,
                    payment_deadline_at
                 FROM marketplace_orders
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [orderId]
            );

            if (!orders.length) {
                await conn.rollback();

                return res.status(404).json({
                    success: false,
                    message: "Không tìm thấy đơn hàng."
                });
            }

            // Lock payment after order.
            const [payments] = await conn.execute(
                `SELECT *
                 FROM marketplace_order_payments
                 WHERE id = ?
                   AND order_id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [paymentId, orderId]
            );

            if (!payments.length) {
                await conn.rollback();

                return res.status(404).json({
                    success: false,
                    message: "Không tìm thấy khoản thanh toán."
                });
            }

            const order = orders[0];
            const payment = payments[0];

            if (!["pending", "processing"].includes(payment.status)) {
                await conn.rollback();

                return rollbackResponse(
                    res,
                    409,
                    "PAYMENT_ALREADY_PROCESSED",
                    `Khoản thanh toán đã ở trạng thái ${payment.status}, không thể xác minh lại.`
                );
            }

            let finalOrderPaymentStatus = order.payment_status;
            let finalOrderStatus = order.order_status;

            if (decision === "paid") {
                if (payment.payment_method !== "bank_transfer") {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        400,
                        "UNSUPPORTED_PAYMENT_METHOD",
                        "API này chỉ xác minh chuyển khoản ngân hàng."
                    );
                }

                if (!payment.submitted_at || !payment.receipt_storage_key) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "PAYMENT_RECEIPT_REQUIRED",
                        "Người mua chưa gửi biên lai thanh toán."
                    );
                }

                if (
                    ["cancelled", "refunded", "disputed"].includes(order.order_status) ||
                    ["cancelled", "refunded", "partially_refunded"].includes(order.payment_status)
                ) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "ORDER_NOT_PAYABLE",
                        "Đơn hàng đã bị hủy, hoàn tiền hoặc tranh chấp. Không thể xác nhận thanh toán."
                    );
                }

                if (
                    !["pending", "processing"].includes(order.payment_status) ||
                    !["pending_payment", "processing"].includes(order.order_status)
                ) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "ORDER_NOT_PAYABLE",
                        "Trạng thái đơn hàng không cho phép xác nhận thanh toán."
                    );
                }

                // Finance may review late, but the buyer must have submitted
                // the receipt on or before the payment deadline.
                if (
                    !order.payment_deadline_at ||
                    new Date(payment.submitted_at).getTime() >
                    new Date(order.payment_deadline_at).getTime()
                ) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "PAYMENT_SUBMITTED_LATE",
                        "Biên nhận được gửi sau hạn thanh toán. Không thể xác nhận theo quy trình thông thường."
                    );
                }

                const orderAmount = toCents(order.total_amount);
                const paymentAmount = toCents(payment.amount);
                const receivedAmount = toCents(body.receivedAmount);

                if (
                    orderAmount === null ||
                    paymentAmount === null ||
                    receivedAmount === null
                ) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        400,
                        "INVALID_PAYMENT_AMOUNT",
                        "Số tiền không hợp lệ."
                    );
                }

                if (
                    paymentAmount !== orderAmount ||
                    receivedAmount !== orderAmount
                ) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "PAYMENT_AMOUNT_MISMATCH",
                        "Số tiền thực nhận không khớp chính xác tổng tiền đơn hàng. Không thể tự động xác nhận.",
                        {
                            orderAmount: String(order.total_amount),
                            paymentAmount: String(payment.amount),
                            receivedAmount: String(body.receivedAmount)
                        }
                    );
                }

                if (payment.currency !== order.currency) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "PAYMENT_CURRENCY_MISMATCH",
                        "Đơn vị tiền tệ của khoản thanh toán không khớp đơn hàng."
                    );
                }

                // Duplicate transaction protection.
                const [duplicates] = await conn.execute(
                    `SELECT id
                     FROM marketplace_order_payments
                     WHERE provider_transaction_id = ?
                       AND id <> ?
                     LIMIT 1`,
                    [transactionId, paymentId]
                );

                if (duplicates.length) {
                    await conn.rollback();

                    return rollbackResponse(
                        res,
                        409,
                        "DUPLICATE_BANK_TRANSACTION",
                        "Mã giao dịch ngân hàng đã được sử dụng cho khoản thanh toán khác."
                    );
                }

                // Mark this payment as paid.
                await conn.execute(
                    `UPDATE marketplace_order_payments
                     SET status = 'paid',
                         provider = 'manual_bank_transfer',
                         provider_transaction_id = ?,
                         verified_by_user_id = ?,
                         verified_at = NOW(),
                         verification_note = ?,
                         paid_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [
                        transactionId,
                        actorUserId,
                        note || null,
                        paymentId
                    ]
                );

                // Cancel other payment attempts.
                await conn.execute(
                    `UPDATE marketplace_order_payments
                     SET status = 'cancelled',
                         updated_at = NOW()
                     WHERE order_id = ?
                       AND id <> ?
                       AND status IN ('pending', 'processing')`,
                    [orderId, paymentId]
                );

                // Lock order items independently.
                // Avoid locking the nullable side of a LEFT JOIN.
                const [orderItems] = await conn.execute(
                    `SELECT
                        id,
                        order_id,
                        seller_id,
                        seller_user_id,
                        line_total,
                        currency
                     FROM marketplace_order_items
                     WHERE order_id = ?
                     ORDER BY id ASC
                     FOR UPDATE`,
                    [orderId]
                );

                if (!orderItems.length) {
                    throw new Error("ORDER_ITEMS_NOT_FOUND");
                }

                // Create commissions for items delivered before payment.
                // Commission values must come from Delivery snapshots.
                for (const item of orderItems) {
                    const [deliveries] = await conn.execute(
                        `SELECT
                            id,
                            status,
                            protection_days,
                            protection_started_at,
                            protection_ends_at,
                            seller_rate,
                            platform_rate
                         FROM marketplace_deliveries
                         WHERE order_item_id = ?
                         LIMIT 1
                         FOR UPDATE`,
                        [item.id]
                    );

                    if (!deliveries.length) continue;

                    const delivery = deliveries[0];

                    if (!["delivered", "confirmed"].includes(delivery.status)) {
                        continue;
                    }

                    await createCommissionForDeliveredItem(
                        conn,
                        {
                            ...item,
                            payment_status: "paid",
                            order_status: order.order_status
                        },
                        delivery,
                        actorUserId
                    );
                }

                // Revoke unused authorizations.
                // Used authorizations remain as audit history.
                await conn.execute(
                    `UPDATE marketplace_delivery_authorizations a
                     INNER JOIN marketplace_order_items oi
                        ON oi.id = a.order_item_id
                     SET a.status = 'revoked',
                         a.revoked_by = ?,
                         a.revoked_at = NOW(),
                         a.revocation_reason = 'Order payment confirmed',
                         a.updated_at = NOW()
                     WHERE oi.order_id = ?
                       AND a.status = 'authorized'`,
                    [actorUserId, orderId]
                );

                // Derive order status from actual delivery progress.
                const [[deliveryCounts]] = await conn.execute(
                    `SELECT
                        COUNT(*) AS total_items,
                        SUM(
                            CASE
                                WHEN d.status IN ('delivered', 'confirmed')
                                THEN 1 ELSE 0
                            END
                        ) AS delivered_items,
                        SUM(
                            CASE
                                WHEN d.status = 'confirmed'
                                THEN 1 ELSE 0
                            END
                        ) AS confirmed_items
                     FROM marketplace_order_items oi
                     LEFT JOIN marketplace_deliveries d
                        ON d.order_item_id = oi.id
                     WHERE oi.order_id = ?`,
                    [orderId]
                );

                const totalItems = Number(deliveryCounts.total_items || 0);
                const deliveredItems = Number(deliveryCounts.delivered_items || 0);
                const confirmedItems = Number(deliveryCounts.confirmed_items || 0);

                if (totalItems > 0 && confirmedItems >= totalItems) {
                    finalOrderStatus = "completed";
                } else if (totalItems > 0 && deliveredItems >= totalItems) {
                    finalOrderStatus = "delivered";
                } else if (deliveredItems > 0) {
                    finalOrderStatus = "partially_delivered";
                } else {
                    finalOrderStatus = "paid";
                }

                finalOrderPaymentStatus = "paid";

                await conn.execute(
                    `UPDATE marketplace_orders
                     SET payment_status = 'paid',
                         order_status = ?,
                         paid_at = COALESCE(paid_at, NOW()),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [finalOrderStatus, orderId]
                );
         
} else {
    // Reject only the current payment attempt.
    await conn.execute(
        `UPDATE marketplace_order_payments
         SET status = 'failed',
             verified_by_user_id = ?,
             verified_at = NOW(),
             verification_note = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [actorUserId, note, paymentId]
    );

    // Check whether another payment is still awaiting Finance review.
    const [[activePayments]] = await conn.execute(
        `SELECT
            SUM(
                CASE WHEN status = 'processing'
                THEN 1 ELSE 0 END
            ) AS processing_count
         FROM marketplace_order_payments
         WHERE order_id = ?
           AND status IN ('pending', 'processing')`,
        [orderId]
    );

    const processingCount = Number(
        activePayments.processing_count || 0
    );

    const [[orderState]] = await conn.execute(
        `SELECT
            CASE
                WHEN payment_deadline_at IS NOT NULL
                 AND payment_deadline_at <= NOW()
                THEN 1 ELSE 0
            END AS expired,
            EXISTS (
                SELECT 1
                FROM marketplace_order_items oi
                INNER JOIN marketplace_deliveries d
                    ON d.order_item_id = oi.id
                WHERE oi.order_id = marketplace_orders.id
            ) AS has_delivery
         FROM marketplace_orders
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderId]
    );

    const expired = Number(orderState?.expired || 0) === 1;
    const hasDelivery = Number(orderState?.has_delivery || 0) === 1;

    if (processingCount > 0) {
        // Another payment is still awaiting Finance review.
        // Preserve the existing Order delivery progress.
        finalOrderPaymentStatus = "processing";
        finalOrderStatus = order.order_status;

        await conn.execute(
            `UPDATE marketplace_orders
             SET payment_status = 'processing',
                 updated_at = NOW()
             WHERE id = ?
               AND payment_status IN ('pending', 'processing')`,
            [orderId]
        );

    } else if (expired && hasDelivery) {
        // An Admin-authorized Delivery already exists.
        // Do not cancel the Order or revoke its remaining authorization.
        // Preserve the current Order state for manual resolution.
        finalOrderPaymentStatus = order.payment_status;
        finalOrderStatus = order.order_status;

    } else if (expired) {
        // Expired and no Delivery exists: safe to cancel.
        await conn.execute(
            `UPDATE marketplace_order_payments
             SET status = 'cancelled',
                 updated_at = NOW()
             WHERE order_id = ?
               AND status = 'pending'`,
            [orderId]
        );

        await conn.execute(
            `UPDATE marketplace_delivery_authorizations a
             INNER JOIN marketplace_order_items oi
                ON oi.id = a.order_item_id
             SET a.status = 'revoked',
                 a.revoked_by = ?,
                 a.revoked_at = NOW(),
                 a.revocation_reason = 'Order payment deadline expired',
                 a.updated_at = NOW()
             WHERE oi.order_id = ?
               AND a.status = 'authorized'`,
            [actorUserId, orderId]
        );

        finalOrderPaymentStatus = "cancelled";
        finalOrderStatus = "cancelled";

        await conn.execute(
            `UPDATE marketplace_orders
             SET payment_status = 'cancelled',
                 order_status = 'cancelled',
                 cancelled_at = COALESCE(cancelled_at, NOW()),
                 updated_at = NOW()
             WHERE id = ?
               AND payment_status IN ('pending', 'processing')
               AND order_status IN ('pending_payment', 'processing')
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_order_items oi
                   INNER JOIN marketplace_deliveries d
                       ON d.order_item_id = oi.id
                   WHERE oi.order_id = marketplace_orders.id
               )`,
            [orderId]
        );

    } else {
        // No processing payment remains and the deadline has not expired.
        // Keep existing delivery progress if a Delivery exists.
        finalOrderPaymentStatus = "pending";
        finalOrderStatus = hasDelivery
            ? order.order_status
            : "pending_payment";

        await conn.execute(
            `UPDATE marketplace_orders
             SET payment_status = 'pending',
                 order_status = ?,
                 updated_at = NOW()
             WHERE id = ?
               AND payment_status IN ('pending', 'processing')
               AND order_status NOT IN (
                    'cancelled', 'disputed', 'refunded'
               )`,
            [finalOrderStatus, orderId]
        );
    }
}


            await writeAudit(conn, {
                actorUserId,
                action: decision === "paid"
                    ? "marketplace_payment_verified"
                    : "marketplace_payment_rejected",
                entityType: "marketplace_order_payment",
                entityId: String(paymentId),
                oldData: {
                    paymentStatus: payment.status,
                    orderPaymentStatus: order.payment_status,
                    orderStatus: order.order_status
                },
                newData: {
                    paymentStatus: decision,
                    orderPaymentStatus: finalOrderPaymentStatus,
                    orderStatus: finalOrderStatus,
                    providerTransactionId: decision === "paid"
                        ? transactionId
                        : null,
                    verificationNote: note || null
                },
                ipAddress: req.ip,
                userAgent: req.get("user-agent") || null
            });

            await conn.commit();
            committed = true;

            return res.json({
                success: true,
                message: decision === "paid"
                    ? "Đã xác minh thanh toán thành công."
                    : "Đã từ chối khoản thanh toán.",
                data: {
                    paymentId,
                    orderId,
                    paymentStatus: decision,
                    orderPaymentStatus: finalOrderPaymentStatus,
                    orderStatus: finalOrderStatus
                }
            });
        } catch (err) {
            if (conn && !committed) {
                try {
                    await conn.rollback();
                } catch (_) {}
            }

            if (err.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    success: false,
                    code: "DUPLICATE_BANK_TRANSACTION",
                    message: "Mã giao dịch ngân hàng đã được sử dụng."
                });
            }

            if (err.code === "ORDER_ITEMS_NOT_FOUND") {
                return res.status(409).json({
                    success: false,
                    code: "ORDER_ITEMS_NOT_FOUND",
                    message: "Đơn hàng không có sản phẩm hợp lệ để xác minh."
                });
            }

            console.error("MARKETPLACE PAYMENT VERIFICATION ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Không thể xử lý xác minh thanh toán."
            });
        } finally {
            if (conn) conn.release();
        }
    }
);

// ========================================
// GET: VIEW PAYMENT RECEIPT
// GET /api/marketplace/admin/payments/:id/receipt
// ========================================

router.get("/payments/:id/receipt", async (req, res) => {
    try {
        const paymentId = validId(req.params.id);

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                message: "Payment ID không hợp lệ."
            });
        }

        const [rows] = await db.execute(
            `SELECT receipt_storage_key
             FROM marketplace_order_payments
             WHERE id = ?
             LIMIT 1`,
            [paymentId]
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy khoản thanh toán."
            });
        }

        if (!rows[0].receipt_storage_key) {
            return res.status(404).json({
                success: false,
                message: "Khoản thanh toán chưa có biên nhận."
            });
        }

        return sendReceiptFile(res, rows[0].receipt_storage_key);
    } catch (err) {
        console.error("FINANCE RECEIPT ACCESS ERROR:", err);

        if (res.headersSent) return;

        return res.status(500).json({
            success: false,
            message: "Không thể xem biên lai."
        });
    }
});

module.exports = router;
