
"use strict";

const crypto = require("crypto");
const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const ACTIVE_PAYOUT_STATUSES = [
    "pending",
    "under_review",
    "approved",
    "processing"
];

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

const ALLOWED_PAYOUT_STATUSES = [
    "pending",
    "under_review",
    "approved",
    "processing",
    "paid",
    "rejected",
    "cancelled"
];

function positiveId(value, error = "INVALID_ID") {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        const err = new Error(error);
        err.code = error;
        throw err;
    }

    return id;
}

function toCents(value) {
    const text = String(value ?? "").trim();

    if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
        const error = new Error("INVALID_PAYOUT_AMOUNT");
        error.code = "INVALID_PAYOUT_AMOUNT";
        throw error;
    }

    const [whole, fraction = ""] = text.split(".");
    const cents =
        BigInt(whole) * 100n +
        BigInt(fraction.padEnd(2, "0"));

    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
        const error = new Error("INVALID_PAYOUT_AMOUNT");
        error.code = "INVALID_PAYOUT_AMOUNT";
        throw error;
    }

    return Number(cents);
}

function formatAmount(cents) {
    return (cents / 100).toFixed(2);
}

function generateRequestCode() {
    const date = new Date();

    const datePart = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("");

    return `MPO-${datePart}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function auditData(userId, payoutId, action, oldData, newData, audit = {}) {
    return {
        ...audit,
        actorUserId: userId,
        targetUserId: userId,
        action,
        entityType: "marketplace_payout_request",
        entityId: String(payoutId),
        oldData: oldData || null,
        newData: newData || null
    };
}

function maskAccountNumber(value) {
    const accountNumber = String(value || "");

    if (!accountNumber) return null;

    if (accountNumber.length <= 4) {
        return "****";
    }

    return `${"*".repeat(Math.min(accountNumber.length - 4, 8))}${accountNumber.slice(-4)}`;
}

function safePayout(row) {
    let bank = {};

    try {
        bank = typeof row.bank_snapshot === "string"
            ? JSON.parse(row.bank_snapshot)
            : row.bank_snapshot || {};
    } catch (_) {
        bank = {};
    }

    return {
        id: row.id,
        requestCode: row.request_code,
        payoutMethod: row.payout_method,
        totalAmount: row.total_amount,
        currency: row.currency,
        status: row.status,
        bank: {
            bankName: bank.bankName || null,
            bankCode: bank.bankCode || null,
            accountNumber: maskAccountNumber(bank.accountNumber),
            accountHolder: bank.accountHolder || null,
            branch: bank.branch || null
        },
        adminNote: row.admin_note,
        rejectionReason: row.rejection_reason,
        transactionReference: row.transaction_reference,
        requestedAt: row.requested_at,
        reviewedAt: row.reviewed_at,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function getSeller(conn, userId, lock = false) {
    const [rows] = await conn.execute(
        `SELECT id, user_id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [userId]
    );

    if (!rows.length) {
        const error = new Error("SELLER_NOT_FOUND");
        error.code = "SELLER_NOT_FOUND";
        throw error;
    }

    if (rows[0].status !== "active") {
        const error = new Error("SELLER_NOT_ACTIVE");
        error.code = "SELLER_NOT_ACTIVE";
        throw error;
    }

    return rows[0];
}

async function getMyPayouts(userId, options = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const requestedPage = Number.parseInt(options.page, 10);
    const requestedLimit = Number.parseInt(options.limit, 10);

    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 1000000)
        : 1;

    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 20;

    const offset = (page - 1) * limit;

    const status = options.status
        ? String(options.status).trim()
        : null;

    if (status && !ALLOWED_PAYOUT_STATUSES.includes(status)) {
        const error = new Error("INVALID_PAYOUT_STATUS");
        error.code = "INVALID_PAYOUT_STATUS";
        throw error;
    }

    const [sellers] = await db.execute(
        `SELECT id
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellers.length) {
        const error = new Error("SELLER_NOT_FOUND");
        error.code = "SELLER_NOT_FOUND";
        throw error;
    }

    // Seller đã bị suspended/closed vẫn được xem lịch sử Payout.
    const sellerId = sellers[0].id;

    const statusCondition = status
        ? "AND status = ?"
        : "";

    const queryParams = status
        ? [sellerId, status]
        : [sellerId];

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_payout_requests
         WHERE seller_id = ?
         ${statusCondition}`,
        queryParams
    );

    const [rows] = await db.execute(
        `SELECT *
         FROM marketplace_payout_requests
         WHERE seller_id = ?
         ${statusCondition}
         ORDER BY requested_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
    );

    const total = Number(countRows[0].total || 0);

    return {
        items: rows.map(safePayout),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getMyPayoutDetail(userId, payoutId) {
    userId = positiveId(userId, "INVALID_USER_ID");
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");

    const [sellers] = await db.execute(
        `SELECT id
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellers.length) {
        const error = new Error("SELLER_NOT_FOUND");
        error.code = "SELLER_NOT_FOUND";
        throw error;
    }

    // Seller đã bị suspended/closed vẫn được xem chi tiết Payout.
    const [rows] = await db.execute(
        `SELECT *
         FROM marketplace_payout_requests
         WHERE id = ?
           AND seller_id = ?
         LIMIT 1`,
        [payoutId, sellers[0].id]
    );

    if (!rows.length) {
        const error = new Error("PAYOUT_REQUEST_NOT_FOUND");
        error.code = "PAYOUT_REQUEST_NOT_FOUND";
        throw error;
    }

    const payout = safePayout(rows[0]);

    const [items] = await db.execute(
        `SELECT
            pi.id,
            pi.commission_id,
            pi.amount,
            pi.currency,
            pi.status,
            pi.created_at,
            c.order_id,
            c.order_item_id,
            oi.product_title
         FROM marketplace_payout_items pi
         INNER JOIN marketplace_commissions c
            ON c.id = pi.commission_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id
         WHERE pi.payout_request_id = ?
         ORDER BY pi.id ASC`,
        [payoutId]
    );

    const [transactions] = await db.execute(
        `SELECT
            id,
            event_type,
            amount,
            currency,
            external_reference,
            note,
            created_at
         FROM marketplace_payout_transactions
         WHERE payout_request_id = ?
         ORDER BY created_at ASC, id ASC`,
        [payoutId]
    );

    return {
        ...payout,
        items: items.map(item => ({
            id: item.id,
            commissionId: item.commission_id,
            orderId: item.order_id,
            orderItemId: item.order_item_id,
            productTitle: item.product_title,
            amount: item.amount,
            currency: item.currency,
            status: item.status,
            createdAt: item.created_at
        })),
        transactions: transactions.map(event => ({
            id: event.id,
            eventType: event.event_type,
            amount: event.amount,
            currency: event.currency,
            externalReference: event.external_reference,
            note: event.note,
            createdAt: event.created_at
        }))
    };
}

async function createPayoutRequest(userId, data = {}, audit = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");

    if (!Array.isArray(data.commissionIds) || !data.commissionIds.length) {
        const error = new Error("PAYOUT_COMMISSION_IDS_REQUIRED");
        error.code = "PAYOUT_COMMISSION_IDS_REQUIRED";
        throw error;
    }

    if (data.commissionIds.length > 100) {
        const error = new Error("PAYOUT_TOO_MANY_COMMISSIONS");
        error.code = "PAYOUT_TOO_MANY_COMMISSIONS";
        throw error;
    }

    const commissionIds = [
        ...new Set(
            data.commissionIds.map(id =>
                positiveId(id, "INVALID_COMMISSION_ID")
            )
        )
    ];

    if (commissionIds.length !== data.commissionIds.length) {
        const error = new Error("DUPLICATE_PAYOUT_COMMISSION");
        error.code = "DUPLICATE_PAYOUT_COMMISSION";
        throw error;
    }

    const requestedBankAccountId =
        data.bankAccountId !== undefined &&
        data.bankAccountId !== null &&
        data.bankAccountId !== ""
            ? positiveId(data.bankAccountId, "INVALID_BANK_ACCOUNT_ID")
            : null;

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        // Lock Seller to serialize payout and bank-account operations.
        const seller = await getSeller(conn, userId, true);

        let bankRows;

        if (requestedBankAccountId) {
            [bankRows] = await conn.execute(
                `SELECT *
                 FROM marketplace_seller_bank_accounts
                 WHERE id = ?
                   AND seller_id = ?
                   AND status = 'active'
                 LIMIT 1
                 FOR UPDATE`,
                [requestedBankAccountId, seller.id]
            );
        } else {
            [bankRows] = await conn.execute(
                `SELECT *
                 FROM marketplace_seller_bank_accounts
                 WHERE seller_id = ?
                   AND status = 'active'
                 ORDER BY is_default DESC, created_at ASC, id ASC
                 LIMIT 1
                 FOR UPDATE`,
                [seller.id]
            );
        }

        if (!bankRows.length) {
            const error = new Error("SELLER_BANK_ACCOUNT_NOT_FOUND");
            error.code = "SELLER_BANK_ACCOUNT_NOT_FOUND";
            throw error;
        }

        const bank = bankRows[0];
        const placeholders = commissionIds.map(() => "?").join(",");

        /*
         * Bước 1: Đọc tham chiếu Commission không khóa.
         * Chỉ dùng để xác định các Order và Order Item cần khóa.
         * Dữ liệu nghiệp vụ sẽ được đọc lại sau khi khóa Commission.
         */
        const [commissionRefs] = await conn.execute(
            `SELECT id, order_id, order_item_id
             FROM marketplace_commissions
             WHERE id IN (${placeholders})
               AND seller_id = ?
               AND seller_user_id = ?
             ORDER BY id ASC`,
            [...commissionIds, seller.id, userId]
        );

        if (commissionRefs.length !== commissionIds.length) {
            const error = new Error("PAYOUT_COMMISSION_NOT_FOUND");
            error.code = "PAYOUT_COMMISSION_NOT_FOUND";
            throw error;
        }

        if (commissionRefs.some(row =>
            !Number.isSafeInteger(Number(row.order_id)) ||
            Number(row.order_id) <= 0 ||
            !Number.isSafeInteger(Number(row.order_item_id)) ||
            Number(row.order_item_id) <= 0
        )) {
            const error = new Error("PAYOUT_COMMISSION_RELATION_INVALID");
            error.code = "PAYOUT_COMMISSION_RELATION_INVALID";
            throw error;
        }

        /*
         * Bước 2: Khóa tất cả Order theo ID tăng dần.
         */
        const orderIds = [
            ...new Set(commissionRefs.map(row => Number(row.order_id)))
        ].sort((a, b) => a - b);

        const orderPlaceholders = orderIds.map(() => "?").join(",");

        const [orders] = await conn.execute(
            `SELECT id, payment_status, order_status
             FROM marketplace_orders
             WHERE id IN (${orderPlaceholders})
             ORDER BY id ASC
             FOR UPDATE`,
            orderIds
        );

        if (orders.length !== orderIds.length) {
            const error = new Error("PAYOUT_ORDER_NOT_FOUND");
            error.code = "PAYOUT_ORDER_NOT_FOUND";
            throw error;
        }

        const orderMap = new Map(
            orders.map(row => [Number(row.id), row])
        );

        /*
         * Bước 3: Khóa tất cả Order Item theo ID tăng dần.
         */
        const orderItemIds = [
            ...new Set(commissionRefs.map(row => Number(row.order_item_id)))
        ].sort((a, b) => a - b);

        const itemPlaceholders = orderItemIds.map(() => "?").join(",");

        const [orderItems] = await conn.execute(
            `SELECT id, order_id
             FROM marketplace_order_items
             WHERE id IN (${itemPlaceholders})
             ORDER BY id ASC
             FOR UPDATE`,
            orderItemIds
        );

        if (orderItems.length !== orderItemIds.length) {
            const error = new Error("PAYOUT_ORDER_ITEM_NOT_FOUND");
            error.code = "PAYOUT_ORDER_ITEM_NOT_FOUND";
            throw error;
        }

        const orderItemMap = new Map(
            orderItems.map(row => [Number(row.id), row])
        );

        for (const ref of commissionRefs) {
            const orderItem = orderItemMap.get(Number(ref.order_item_id));

            if (
                !orderItem ||
                Number(orderItem.order_id) !== Number(ref.order_id)
            ) {
                const error = new Error("PAYOUT_COMMISSION_RELATION_INVALID");
                error.code = "PAYOUT_COMMISSION_RELATION_INVALID";
                throw error;
            }
        }

        /*
         * Bước 4: Khóa Commission theo ID tăng dần.
         * Đây mới là dữ liệu chính thức để xác thực và tính tiền.
         */
        const [commissions] = await conn.execute(
            `SELECT *
             FROM marketplace_commissions
             WHERE id IN (${placeholders})
               AND seller_id = ?
               AND seller_user_id = ?
             ORDER BY id ASC
             FOR UPDATE`,
            [...commissionIds, seller.id, userId]
        );

        if (commissions.length !== commissionIds.length) {
            const error = new Error("PAYOUT_COMMISSION_NOT_FOUND");
            error.code = "PAYOUT_COMMISSION_NOT_FOUND";
            throw error;
        }

        const commissionMap = new Map(
            commissions.map(row => [Number(row.id), row])
        );

        let totalCents = 0;

        for (const commissionId of commissionIds) {
            const commission = commissionMap.get(commissionId);

            if (!commission) {
                const error = new Error("PAYOUT_COMMISSION_NOT_FOUND");
                error.code = "PAYOUT_COMMISSION_NOT_FOUND";
                throw error;
            }

            if (commission.status !== "available") {
                const error = new Error("PAYOUT_COMMISSION_NOT_AVAILABLE");
                error.code = "PAYOUT_COMMISSION_NOT_AVAILABLE";
                throw error;
            }

            if (
                !commission.eligible_at ||
                new Date(commission.eligible_at).getTime() > Date.now()
            ) {
                const error = new Error("PAYOUT_COMMISSION_NOT_ELIGIBLE");
                error.code = "PAYOUT_COMMISSION_NOT_ELIGIBLE";
                throw error;
            }

            if (commission.currency !== "VND") {
                const error = new Error("PAYOUT_CURRENCY_NOT_SUPPORTED");
                error.code = "PAYOUT_CURRENCY_NOT_SUPPORTED";
                throw error;
            }

            const sellerAmount = toCents(commission.seller_amount);
            const paidAmount = toCents(commission.paid_amount || 0);
            const reversedAmount = toCents(commission.reversed_amount || 0);

            const remainingAmount =
                sellerAmount - paidAmount - reversedAmount;

            if (remainingAmount <= 0) {
                const error = new Error("PAYOUT_COMMISSION_NO_REMAINING_AMOUNT");
                error.code = "PAYOUT_COMMISSION_NO_REMAINING_AMOUNT";
                throw error;
            }

            commission._payoutAmountCents = remainingAmount;
            totalCents += remainingAmount;

            if (!Number.isSafeInteger(totalCents)) {
                const error = new Error("INVALID_PAYOUT_AMOUNT");
                error.code = "INVALID_PAYOUT_AMOUNT";
                throw error;
            }
        }

        if (totalCents <= 0) {
            const error = new Error("INVALID_PAYOUT_AMOUNT");
            error.code = "INVALID_PAYOUT_AMOUNT";
            throw error;
        }

        /*
         * Bước 5: Kiểm tra trạng thái Order đã khóa.
         */
        for (const commission of commissions) {
            const order = orderMap.get(Number(commission.order_id));

            if (!order) {
                const error = new Error("PAYOUT_ORDER_NOT_FOUND");
                error.code = "PAYOUT_ORDER_NOT_FOUND";
                throw error;
            }

            if (
                order.payment_status !== "paid" ||
                [
                    "cancelled",
                    "disputed",
                    "refunded",
                    "partially_refunded"
                ].includes(order.order_status)
            ) {
                const error = new Error("PAYOUT_ORDER_NOT_ELIGIBLE");
                error.code = "PAYOUT_ORDER_NOT_ELIGIBLE";
                throw error;
            }

            const orderItem = orderItemMap.get(
                Number(commission.order_item_id)
            );

            if (
                !orderItem ||
                Number(orderItem.order_id) !== Number(commission.order_id)
            ) {
                const error = new Error("PAYOUT_COMMISSION_RELATION_INVALID");
                error.code = "PAYOUT_COMMISSION_RELATION_INVALID";
                throw error;
            }
        }

        /*
         * Bước 6: Khóa tất cả Delivery theo ID tăng dần.
         */
        const [deliveries] = await conn.execute(
            `SELECT id, order_item_id, status
             FROM marketplace_deliveries
             WHERE order_item_id IN (${itemPlaceholders})
             ORDER BY id ASC
             FOR UPDATE`,
            orderItemIds
        );

        const deliveryMap = new Map(
            deliveries.map(row => [Number(row.order_item_id), row])
        );

        for (const commission of commissions) {
            const delivery = deliveryMap.get(
                Number(commission.order_item_id)
            );

            if (
                !delivery ||
                !["delivered", "confirmed"].includes(delivery.status)
            ) {
                const error = new Error("PAYOUT_DELIVERY_NOT_COMPLETED");
                error.code = "PAYOUT_DELIVERY_NOT_COMPLETED";
                throw error;
            }
        }

        /*
         * Bước 7: Khóa toàn bộ Commission Hold đang active.
         */
        const [holds] = await conn.execute(
            `SELECT id, commission_id
             FROM marketplace_commission_holds
             WHERE commission_id IN (${placeholders})
               AND status = 'active'
             ORDER BY id ASC
             FOR UPDATE`,
            commissionIds
        );

        if (holds.length) {
            const error = new Error("PAYOUT_COMMISSION_ON_HOLD");
            error.code = "PAYOUT_COMMISSION_ON_HOLD";
            throw error;
        }

        /*
         * Bước 8: Khóa tất cả Ticket đang active liên quan.
         * Bao gồm Ticket cấp Order (order_item_id IS NULL)
         * và Ticket cấp từng Order Item.
         */
        const [tickets] = await conn.execute(
            `SELECT t.id
             FROM marketplace_support_tickets t
             WHERE t.seller_user_id = ?
               AND t.status IN (${ACTIVE_TICKET_STATUSES.map(() => "?").join(",")})
               AND t.order_id IN (${orderPlaceholders})
               AND (
                    t.order_item_id IS NULL
                    OR t.order_item_id IN (${itemPlaceholders})
               )
             ORDER BY t.id ASC
             FOR UPDATE`,
            [
                userId,
                ...ACTIVE_TICKET_STATUSES,
                ...orderIds,
                ...orderItemIds
            ]
        );

        if (tickets.length) {
            const error = new Error("PAYOUT_COMMISSION_HAS_ACTIVE_TICKET");
            error.code = "PAYOUT_COMMISSION_HAS_ACTIVE_TICKET";
            throw error;
        }

        /*
         * Bước 9: Kiểm tra Payout Item thuộc các Payout đang hoạt động.
         */
        const [existingItems] = await conn.execute(
            `SELECT
                pi.id,
                pi.commission_id,
                pr.id AS payout_request_id
             FROM marketplace_payout_items pi
             INNER JOIN marketplace_payout_requests pr
                ON pr.id = pi.payout_request_id
             WHERE pi.commission_id IN (${placeholders})
               AND pr.status IN (${ACTIVE_PAYOUT_STATUSES.map(() => "?").join(",")})
             ORDER BY pi.id ASC
             FOR UPDATE`,
            [...commissionIds, ...ACTIVE_PAYOUT_STATUSES]
        );

        if (existingItems.length) {
            const error = new Error("PAYOUT_COMMISSION_ALREADY_REQUESTED");
            error.code = "PAYOUT_COMMISSION_ALREADY_REQUESTED";
            throw error;
        }

        /*
         * Bước 10: Tạo Payout Request và Payout Items.
         */
        const totalAmount = formatAmount(totalCents);
        const requestCode = generateRequestCode();

        // Snapshot ngân hàng bất biến theo từng yêu cầu Payout.
        const bankSnapshot = {
            bankAccountId: bank.id,
            bankName: bank.bank_name,
            bankCode: bank.bank_code,
            accountNumber: bank.account_number,
            accountHolder: bank.account_holder,
            branch: bank.branch
        };

        const [requestResult] = await conn.execute(
            `INSERT INTO marketplace_payout_requests
             (
                request_code,
                seller_id,
                seller_user_id,
                payout_method,
                total_amount,
                currency,
                bank_snapshot,
                status,
                requested_at
             )
             VALUES (?, ?, ?, 'bank_transfer', ?, 'VND', ?, 'pending', NOW())`,
            [
                requestCode,
                seller.id,
                userId,
                totalAmount,
                JSON.stringify(bankSnapshot)
            ]
        );

        const payoutId = requestResult.insertId;

        for (const commission of commissions) {
            await conn.execute(
                `INSERT INTO marketplace_payout_items
                 (
                    payout_request_id,
                    commission_id,
                    amount,
                    currency,
                    status
                 )
                 VALUES (?, ?, ?, 'VND', 'requested')`,
                [
                    payoutId,
                    commission.id,
                    formatAmount(commission._payoutAmountCents)
                ]
            );

            const [updateResult] = await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = 'payout_requested'
                 WHERE id = ?
                   AND seller_id = ?
                   AND seller_user_id = ?
                   AND status = 'available'
                   AND eligible_at <= NOW()`,
                [commission.id, seller.id, userId]
            );

            if (updateResult.affectedRows !== 1) {
                const error = new Error("PAYOUT_COMMISSION_STATE_CHANGED");
                error.code = "PAYOUT_COMMISSION_STATE_CHANGED";
                throw error;
            }
        }

        await conn.execute(
            `INSERT INTO marketplace_payout_transactions
             (
                payout_request_id,
                event_type,
                amount,
                currency,
                note,
                metadata,
                performed_by_user_id
             )
             VALUES (?, 'submitted', ?, 'VND', ?, ?, ?)`,
            [
                payoutId,
                totalAmount,
                "Seller submitted payout request",
                JSON.stringify({
                    requestCode,
                    commissionCount: commissions.length,
                    bankAccountId: bank.id
                }),
                userId
            ]
        );

        await writeAudit(
            conn,
            auditData(
                userId,
                payoutId,
                "marketplace.payout.requested",
                null,
                {
                    requestCode,
                    totalAmount,
                    currency: "VND",
                    commissionIds,
                    commissionCount: commissions.length,
                    bankAccountId: bank.id,
                    status: "pending"
                },
                audit
            )
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            requestCode,
            totalAmount,
            currency: "VND",
            status: "pending",
            commissionCount: commissions.length,
            requestedAt: new Date()
        };
    } catch (error) {
        if (transactionStarted) {
            try {
                await conn.rollback();
            } catch (rollbackError) {
                console.error(
                    "[MarketplacePayout] Rollback failed:",
                    rollbackError
                );
            }
        }

        if (error.code === "ER_DUP_ENTRY") {
            const duplicateError = new Error("PAYOUT_REQUEST_DUPLICATE");
            duplicateError.code = "PAYOUT_REQUEST_DUPLICATE";
            throw duplicateError;
        }

        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    createPayoutRequest,
    getMyPayouts,
    getMyPayoutDetail
};
