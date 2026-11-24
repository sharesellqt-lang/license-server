
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
        throw new Error(error);
    }

    return id;
}

function toCents(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        throw new Error("INVALID_PAYOUT_AMOUNT");
    }

    const cents = Math.round(number * 100);

    if (!Number.isSafeInteger(cents)) {
        throw new Error("INVALID_PAYOUT_AMOUNT");
    }

    return cents;
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
        throw new Error("SELLER_NOT_FOUND");
    }

    if (rows[0].status !== "active") {
        throw new Error("SELLER_NOT_ACTIVE");
    }

    return rows[0];
}

async function getMyPayouts(userId, options = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const page = Math.max(
        1,
        Number.parseInt(options.page, 10) || 1
    );

    const limit = Math.min(
        50,
        Math.max(1, Number.parseInt(options.limit, 10) || 20)
    );

    const offset = (page - 1) * limit;

    const status = options.status
        ? String(options.status).trim()
        : null;

    if (status && !ALLOWED_PAYOUT_STATUSES.includes(status)) {
        throw new Error("INVALID_PAYOUT_STATUS");
    }

    const [sellers] = await db.execute(
        `SELECT id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellers.length) {
        throw new Error("SELLER_NOT_FOUND");
    }

    if (sellers[0].status !== "active") {
        throw new Error("SELLER_NOT_ACTIVE");
    }

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
         LIMIT ${limit} OFFSET ${offset}`,
        queryParams
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
        `SELECT id, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellers.length) {
        throw new Error("SELLER_NOT_FOUND");
    }

    if (sellers[0].status !== "active") {
        throw new Error("SELLER_NOT_ACTIVE");
    }

    const [rows] = await db.execute(
        `SELECT *
         FROM marketplace_payout_requests
         WHERE id = ?
           AND seller_id = ?
         LIMIT 1`,
        [payoutId, sellers[0].id]
    );

    if (!rows.length) {
        throw new Error("PAYOUT_REQUEST_NOT_FOUND");
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
        throw new Error("PAYOUT_COMMISSION_IDS_REQUIRED");
    }

    if (data.commissionIds.length > 100) {
        throw new Error("PAYOUT_TOO_MANY_COMMISSIONS");
    }

    const commissionIds = [
        ...new Set(
            data.commissionIds.map(id =>
                positiveId(id, "INVALID_COMMISSION_ID")
            )
        )
    ];

    if (commissionIds.length !== data.commissionIds.length) {
        throw new Error("DUPLICATE_PAYOUT_COMMISSION");
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

        // Serialize payout and bank-account operations for this Seller.
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
            throw new Error("SELLER_BANK_ACCOUNT_NOT_FOUND");
        }

        const bank = bankRows[0];

        const placeholders = commissionIds.map(() => "?").join(",");

        // Lock all selected commissions before validating their eligibility.
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
            throw new Error("PAYOUT_COMMISSION_NOT_FOUND");
        }

        const commissionMap = new Map(
            commissions.map(row => [Number(row.id), row])
        );

        let totalCents = 0;

        for (const commissionId of commissionIds) {
            const commission = commissionMap.get(commissionId);

            if (commission.status !== "available") {
                throw new Error("PAYOUT_COMMISSION_NOT_AVAILABLE");
            }

            if (
                !commission.eligible_at ||
                new Date(commission.eligible_at).getTime() > Date.now()
            ) {
                throw new Error("PAYOUT_COMMISSION_NOT_ELIGIBLE");
            }

            if (commission.currency !== "VND") {
                throw new Error("PAYOUT_CURRENCY_NOT_SUPPORTED");
            }

            const sellerAmount = toCents(commission.seller_amount);
            const paidAmount = toCents(commission.paid_amount || 0);
            const reversedAmount = toCents(commission.reversed_amount || 0);

            const remainingAmount =
                sellerAmount - paidAmount - reversedAmount;

            if (remainingAmount <= 0) {
                throw new Error("PAYOUT_COMMISSION_NO_REMAINING_AMOUNT");
            }

            commission._payoutAmountCents = remainingAmount;
            totalCents += remainingAmount;

            if (!Number.isSafeInteger(totalCents)) {
                throw new Error("INVALID_PAYOUT_AMOUNT");
            }
        }

        if (totalCents <= 0) {
            throw new Error("INVALID_PAYOUT_AMOUNT");
        }

        // Lock and validate all related orders.
        const orderIds = [
            ...new Set(commissions.map(row => Number(row.order_id)))
        ];

        const orderPlaceholders = orderIds.map(() => "?").join(",");

        const [orders] = await conn.execute(
            `SELECT id, payment_status, order_status
             FROM marketplace_orders
             WHERE id IN (${orderPlaceholders})
             FOR UPDATE`,
            orderIds
        );

        const orderMap = new Map(
            orders.map(row => [Number(row.id), row])
        );

        for (const commission of commissions) {
            const order = orderMap.get(Number(commission.order_id));

            if (!order) {
                throw new Error("PAYOUT_ORDER_NOT_FOUND");
            }

           if (
                order.payment_status !== "paid" ||
                ["cancelled", "disputed", "refunded", "partially_refunded"].includes(order.order_status)
            ) {
                throw new Error("PAYOUT_ORDER_NOT_ELIGIBLE");
            }

            // A commission must have a delivered or confirmed item.
            const [deliveries] = await conn.execute(
                `SELECT id, status
                 FROM marketplace_deliveries
                 WHERE order_item_id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [commission.order_item_id]
            );

            if (
                !deliveries.length ||
                !["delivered", "confirmed"].includes(deliveries[0].status)
            ) {
                throw new Error("PAYOUT_DELIVERY_NOT_COMPLETED");
            }
        }

        // Any active commission hold blocks payout.
        const [holds] = await conn.execute(
            `SELECT commission_id
             FROM marketplace_commission_holds
             WHERE commission_id IN (${placeholders})
               AND status = 'active'
             LIMIT 1
             FOR UPDATE`,
            commissionIds
        );

        if (holds.length) {
            throw new Error("PAYOUT_COMMISSION_ON_HOLD");
        }

        // A ticket can cover either one order item or the whole order.
        // Only tickets belonging to this Seller block this payout.
        const [tickets] = await conn.execute(
            `SELECT t.id
             FROM marketplace_support_tickets t
             INNER JOIN marketplace_commissions c
                ON c.order_id = t.order_id
               AND (
                    t.order_item_id IS NULL
                    OR t.order_item_id = c.order_item_id
               )
             WHERE c.id IN (${placeholders})
               AND t.seller_user_id = ?
               AND t.status IN (${ACTIVE_TICKET_STATUSES.map(() => "?").join(",")})
             LIMIT 1
             FOR UPDATE`,
            [...commissionIds, userId, ...ACTIVE_TICKET_STATUSES]
        );

        if (tickets.length) {
            throw new Error("PAYOUT_COMMISSION_HAS_ACTIVE_TICKET");
        }

        // Prevent a commission from belonging to another active payout.
        const [existingItems] = await conn.execute(
            `SELECT pi.commission_id
             FROM marketplace_payout_items pi
             INNER JOIN marketplace_payout_requests pr
                ON pr.id = pi.payout_request_id
             WHERE pi.commission_id IN (${placeholders})
               AND pr.status IN (${ACTIVE_PAYOUT_STATUSES.map(() => "?").join(",")})
             LIMIT 1
             FOR UPDATE`,
            [...commissionIds, ...ACTIVE_PAYOUT_STATUSES]
        );

        if (existingItems.length) {
            throw new Error("PAYOUT_COMMISSION_ALREADY_REQUESTED");
        }

        const totalAmount = formatAmount(totalCents);
        const requestCode = generateRequestCode();

        // Snapshot is immutable for this payout request.
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
                throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
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
            await conn.rollback();
        }

        if (error.code === "ER_DUP_ENTRY") {
            throw new Error("PAYOUT_REQUEST_DUPLICATE");
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
