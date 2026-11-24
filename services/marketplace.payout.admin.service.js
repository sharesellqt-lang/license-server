
"use strict";

const crypto = require("crypto");
const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

function positiveId(value, error = "INVALID_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(error);
    return id;
}

function cleanText(value, maxLength = 2000) {
    return String(value || "").trim().slice(0, maxLength);
}

function validDateOnly(value) {
    const date = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date;
}

function auditData(adminUserId, sellerUserId, payoutId, action, oldData, newData, audit = {}) {
    return {
        ...audit,
        actorUserId: adminUserId,
        targetUserId: sellerUserId,
        action,
        entityType: "marketplace_payout_request",
        entityId: String(payoutId),
        oldData: oldData || null,
        newData: newData || null
    };
}

function parseBankSnapshot(value) {
    if (!value) return {};
    try {
        return typeof value === "string" ? JSON.parse(value) : value;
    } catch (_) {
        return {};
    }
}

function safePayout(row) {
    const bank = parseBankSnapshot(row.bank_snapshot);

    return {
        id: row.id,
        requestCode: row.request_code,
        sellerId: row.seller_id,
        sellerUserId: row.seller_user_id,
        payoutMethod: row.payout_method,
        totalAmount: row.total_amount,
        currency: row.currency,
        status: row.status,
        bank: {
            bankAccountId: bank.bankAccountId || null,
            bankName: bank.bankName || null,
            bankCode: bank.bankCode || null,
            accountNumber: bank.accountNumber || null,
            accountHolder: bank.accountHolder || null,
            branch: bank.branch || null
        },
        adminNote: row.admin_note,
        rejectionReason: row.rejection_reason,
        reviewedByUserId: row.reviewed_by_user_id,
        reviewedAt: row.reviewed_at,
        paidAt: row.paid_at,
        transactionReference: row.transaction_reference,
        paymentProofKey: row.payment_proof_key,
        requestedAt: row.requested_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function getPayoutForUpdate(conn, payoutId) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM marketplace_payout_requests
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [payoutId]
    );

    if (!rows.length) throw new Error("PAYOUT_REQUEST_NOT_FOUND");
    return rows[0];
}

async function getPayoutItemsForUpdate(conn, payoutId) {
    const [rows] = await conn.execute(
        `SELECT
            pi.id,
            pi.payout_request_id,
            pi.commission_id,
            pi.amount,
            pi.currency,
            pi.status,
            c.id AS matched_commission_id,
            c.seller_id,
            c.seller_user_id,
            c.order_id,
            c.order_item_id,
            c.seller_amount,
            c.paid_amount,
            c.reversed_amount,
            c.eligible_at,
            c.status AS commission_status
         FROM marketplace_payout_items pi
         LEFT JOIN marketplace_commissions c
            ON c.id = pi.commission_id
         WHERE pi.payout_request_id = ?
         ORDER BY pi.id ASC
         FOR UPDATE`,
        [payoutId]
    );

    if (!rows.length) throw new Error("PAYOUT_ITEMS_NOT_FOUND");

    if (rows.some(item => !item.matched_commission_id)) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    return rows;
}

function assertPayoutItemOwnership(payout, items) {
    for (const item of items) {
        if (
            Number(item.seller_id) !== Number(payout.seller_id) ||
            Number(item.seller_user_id) !== Number(payout.seller_user_id)
        ) {
            throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
        }
    }
}

async function addTransaction(conn, data) {
    await conn.execute(
        `INSERT INTO marketplace_payout_transactions
         (
            payout_request_id,
            event_type,
            amount,
            currency,
            external_reference,
            proof_storage_key,
            note,
            metadata,
            performed_by_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.payoutId,
            data.eventType,
            data.amount || null,
            data.currency || "VND",
            data.externalReference || null,
            data.proofStorageKey || null,
            data.note || null,
            data.metadata ? JSON.stringify(data.metadata) : null,
            data.adminUserId || null
        ]
    );
}

async function writePayoutAudit(conn, payout, adminUserId, action, oldData, newData, audit) {
    await writeAudit(
        conn,
        auditData(
            adminUserId,
            payout.seller_user_id,
            payout.id,
            action,
            oldData,
            newData,
            audit
        )
    );
}

async function getPayoutList(options = {}) {
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const allowedStatuses = [
        "pending",
        "under_review",
        "approved",
        "processing",
        "paid",
        "rejected",
        "cancelled"
    ];

    const status = options.status ? String(options.status).trim() : null;

    if (status && !allowedStatuses.includes(status)) {
        throw new Error("INVALID_PAYOUT_STATUS");
    }

    const sellerId = options.sellerId
        ? positiveId(options.sellerId, "INVALID_SELLER_ID")
        : null;

    const dateFrom = options.dateFrom ? String(options.dateFrom).trim() : null;
    const dateTo = options.dateTo ? String(options.dateTo).trim() : null;

    if (
        (dateFrom && !validDateOnly(dateFrom)) ||
        (dateTo && !validDateOnly(dateTo)) ||
        (dateFrom && dateTo && dateFrom > dateTo)
    ) {
        throw new Error("INVALID_PAYOUT_DATE_FILTER");
    }

    const search = cleanText(options.keyword || options.search, 100);
    const conditions = [];
    const params = [];

    if (status) {
        conditions.push("pr.status = ?");
        params.push(status);
    }

    if (sellerId) {
        conditions.push("pr.seller_id = ?");
        params.push(sellerId);
    }

    if (dateFrom) {
        conditions.push("pr.requested_at >= ?");
        params.push(`${dateFrom} 00:00:00`);
    }

    if (dateTo) {
        conditions.push("pr.requested_at < DATE_ADD(?, INTERVAL 1 DAY)");
        params.push(`${dateTo} 00:00:00`);
    }

    if (search) {
        conditions.push(
            "(pr.request_code LIKE ? OR CAST(pr.seller_user_id AS CHAR) = ?)"
        );
        params.push(`%${search}%`, search);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_payout_requests pr
         ${where}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            pr.*,
            s.display_name AS seller_display_name
         FROM marketplace_payout_requests pr
         LEFT JOIN marketplace_sellers s
            ON s.id = pr.seller_id
         ${where}
         ORDER BY
            FIELD(pr.status, 'pending', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'cancelled'),
            pr.requested_at DESC,
            pr.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const total = Number(countRows[0]?.total || 0);

    return {
        items: rows.map(row => ({
            ...safePayout(row),
            sellerDisplayName: row.seller_display_name || null
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getPayoutDetail(payoutId) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");

    const [rows] = await db.execute(
        `SELECT
            pr.*,
            s.display_name AS seller_display_name,
            s.contact_email AS seller_contact_email,
            s.contact_phone AS seller_contact_phone
         FROM marketplace_payout_requests pr
         LEFT JOIN marketplace_sellers s
            ON s.id = pr.seller_id
         WHERE pr.id = ?
         LIMIT 1`,
        [payoutId]
    );

    if (!rows.length) throw new Error("PAYOUT_REQUEST_NOT_FOUND");

    const payout = rows[0];

    const [items] = await db.execute(
        `SELECT
            pi.id,
            pi.commission_id,
            pi.amount,
            pi.currency,
            pi.status,
            pi.created_at,
            c.id AS matched_commission_id,
            c.seller_id,
            c.seller_user_id,
            c.order_id,
            c.order_item_id,
            c.seller_amount,
            c.paid_amount,
            c.reversed_amount,
            c.status AS commission_status,
            oi.product_title
         FROM marketplace_payout_items pi
         LEFT JOIN marketplace_commissions c
            ON c.id = pi.commission_id
         LEFT JOIN marketplace_order_items oi
            ON oi.id = c.order_item_id
         WHERE pi.payout_request_id = ?
         ORDER BY pi.id ASC`,
        [payoutId]
    );

    if (!items.length) throw new Error("PAYOUT_ITEMS_NOT_FOUND");

    if (items.some(item => !item.matched_commission_id)) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    assertPayoutItemOwnership(payout, items);

    const [transactions] = await db.execute(
        `SELECT
            id,
            event_type,
            amount,
            currency,
            external_reference,
            proof_storage_key,
            note,
            metadata,
            performed_by_user_id,
            created_at
         FROM marketplace_payout_transactions
         WHERE payout_request_id = ?
         ORDER BY created_at ASC, id ASC`,
        [payoutId]
    );

    return {
        ...safePayout(payout),
        seller: {
            sellerId: payout.seller_id,
            userId: payout.seller_user_id,
            displayName: payout.seller_display_name || null,
            contactEmail: payout.seller_contact_email || null,
            contactPhone: payout.seller_contact_phone || null
        },
        items: items.map(item => ({
            id: item.id,
            commissionId: item.commission_id,
            orderId: item.order_id,
            orderItemId: item.order_item_id,
            productTitle: item.product_title,
            amount: item.amount,
            currency: item.currency,
            status: item.status,
            commissionStatus: item.commission_status,
            sellerAmount: item.seller_amount,
            paidAmount: item.paid_amount,
            reversedAmount: item.reversed_amount,
            createdAt: item.created_at
        })),
        transactions: transactions.map(event => ({
            id: event.id,
            eventType: event.event_type,
            amount: event.amount,
            currency: event.currency,
            externalReference: event.external_reference,
            proofStorageKey: event.proof_storage_key,
            note: event.note,
            metadata: event.metadata,
            performedByUserId: event.performed_by_user_id,
            createdAt: event.created_at
        }))
    };
}

async function reviewPayout(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const adminNote = cleanText(data.adminNote, 2000);
    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (payout.status !== "pending") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const [result] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'under_review',
                 admin_note = ?,
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW()
             WHERE id = ?
               AND status = 'pending'`,
            [adminNote || null, adminUserId, payoutId]
        );

        if (result.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "reviewed",
            amount: payout.total_amount,
            currency: payout.currency,
            note: adminNote || "Payout request is under review",
            metadata: { previousStatus: "pending", newStatus: "under_review" },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.reviewed",
            { status: "pending" },
            { status: "under_review", adminNote },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return { id: payoutId, status: "under_review" };
    } catch (error) {
        if (transactionStarted) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function approvePayout(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const adminNote = cleanText(data.adminNote, 2000);
    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (payout.status !== "under_review") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const items = await getPayoutItemsForUpdate(conn, payoutId);
        assertPayoutItemOwnership(payout, items);

        for (const item of items) {
            if (item.commission_status !== "payout_requested") {
                throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
            }

            if (item.status !== "requested") {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }
        }

        const [payoutUpdate] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'approved',
                 admin_note = ?,
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW()
             WHERE id = ?
               AND status = 'under_review'`,
            [adminNote || payout.admin_note, adminUserId, payoutId]
        );

        if (payoutUpdate.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        const [itemUpdate] = await conn.execute(
            `UPDATE marketplace_payout_items
             SET status = 'approved'
             WHERE payout_request_id = ?
               AND status = 'requested'`,
            [payoutId]
        );

        if (itemUpdate.affectedRows !== items.length) {
            throw new Error("PAYOUT_ITEM_UPDATE_CONFLICT");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "approved",
            amount: payout.total_amount,
            currency: payout.currency,
            note: adminNote || "Payout request approved",
            metadata: { previousStatus: "under_review", newStatus: "approved" },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.approved",
            { status: "under_review" },
            { status: "approved", adminNote },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return { id: payoutId, status: "approved" };
    } catch (error) {
        if (transactionStarted) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function restoreCommissionAfterRejection(conn, commission) {
    const [orders] = await conn.execute(
        `SELECT payment_status, order_status
         FROM marketplace_orders
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [commission.order_id]
    );

    if (!orders.length) throw new Error("PAYOUT_ORDER_NOT_FOUND");

    const order = orders[0];

    const orderIsRisky =
        order.payment_status !== "paid" ||
        ["cancelled", "disputed", "refunded", "partially_refunded"]
            .includes(order.order_status);

    const [holds] = await conn.execute(
        `SELECT id
         FROM marketplace_commission_holds
         WHERE commission_id = ?
           AND status = 'active'
         LIMIT 1
         FOR UPDATE`,
        [commission.commission_id]
    );

    const [tickets] = await conn.execute(
        `SELECT id
         FROM marketplace_support_tickets
         WHERE order_id = ?
           AND seller_user_id = ?
           AND (
                order_item_id IS NULL
                OR order_item_id = ?
           )
           AND status IN (${ACTIVE_TICKET_STATUSES.map(() => "?").join(",")})
         LIMIT 1
         FOR UPDATE`,
        [
            commission.order_id,
            commission.seller_user_id,
            commission.order_item_id,
            ...ACTIVE_TICKET_STATUSES
        ]
    );

    let nextStatus = "available";
    let reason = "eligible";

    if (orderIsRisky) {
        nextStatus = "on_hold";
        reason = "order_not_eligible";
    } else if (holds.length) {
        nextStatus = "on_hold";
        reason = "active_commission_hold";
    } else if (tickets.length) {
        nextStatus = "on_hold";
        reason = "active_support_ticket";
    } else if (
        !commission.eligible_at ||
        new Date(commission.eligible_at).getTime() > Date.now()
    ) {
        nextStatus = "pending_protection";
        reason = "protection_not_completed";
    }

    const [updateResult] = await conn.execute(
        `UPDATE marketplace_commissions
         SET status = ?
         WHERE id = ?
           AND status = 'payout_requested'`,
        [nextStatus, commission.commission_id]
    );

    if (updateResult.affectedRows !== 1) {
        throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
    }

    return {
        commissionId: commission.commission_id,
        status: nextStatus,
        reason
    };
}

async function rejectPayout(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const rejectionReason = cleanText(data.rejectionReason, 2000);

    if (!rejectionReason) {
        throw new Error("PAYOUT_REJECTION_REASON_REQUIRED");
    }

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (!["pending", "under_review", "approved"].includes(payout.status)) {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const items = await getPayoutItemsForUpdate(conn, payoutId);
        assertPayoutItemOwnership(payout, items);

        const restoredCommissions = [];

        for (const item of items) {
            if (item.commission_status !== "payout_requested") {
                throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
            }

            if (!["requested", "approved"].includes(item.status)) {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }

            restoredCommissions.push(
                await restoreCommissionAfterRejection(conn, item)
            );
        }

        const [payoutUpdate] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'rejected',
                 rejection_reason = ?,
                 admin_note = ?,
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW()
             WHERE id = ?
               AND status IN ('pending', 'under_review', 'approved')`,
            [
                rejectionReason,
                cleanText(data.adminNote, 2000) || null,
                adminUserId,
                payoutId
            ]
        );

        if (payoutUpdate.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        const [itemUpdate] = await conn.execute(
            `UPDATE marketplace_payout_items
             SET status = 'rejected'
             WHERE payout_request_id = ?
               AND status IN ('requested', 'approved')`,
            [payoutId]
        );

        if (itemUpdate.affectedRows !== items.length) {
            throw new Error("PAYOUT_ITEM_UPDATE_CONFLICT");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "rejected",
            amount: payout.total_amount,
            currency: payout.currency,
            note: rejectionReason,
            metadata: {
                previousStatus: payout.status,
                newStatus: "rejected",
                commissions: restoredCommissions
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.rejected",
            { status: payout.status },
            {
                status: "rejected",
                rejectionReason,
                commissions: restoredCommissions
            },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            status: "rejected",
            commissions: restoredCommissions
        };
    } catch (error) {
        if (transactionStarted) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function markPayoutProcessing(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const adminNote = cleanText(data.adminNote, 2000);
    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (payout.status !== "approved") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const items = await getPayoutItemsForUpdate(conn, payoutId);
        assertPayoutItemOwnership(payout, items);

        for (const item of items) {
            if (
                item.commission_status !== "payout_requested" ||
                item.status !== "approved"
            ) {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }
        }

        const [result] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'processing',
                 admin_note = COALESCE(?, admin_note)
             WHERE id = ?
               AND status = 'approved'`,
            [adminNote || null, payoutId]
        );

        if (result.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "processing",
            amount: payout.total_amount,
            currency: payout.currency,
            note: adminNote || "Payout transfer is processing",
            metadata: { previousStatus: "approved", newStatus: "processing" },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.processing",
            { status: "approved" },
            { status: "processing", adminNote },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return { id: payoutId, status: "processing" };
    } catch (error) {
        if (transactionStarted) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function markPayoutPaid(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const transactionReference = cleanText(data.transactionReference, 255);
    const proofStorageKey = cleanText(data.proofStorageKey, 500);
    const adminNote = cleanText(data.adminNote, 2000);

    if (!transactionReference) {
        throw new Error("PAYOUT_TRANSACTION_REFERENCE_REQUIRED");
    }

    const conn = await db.getConnection();
    let transactionStarted = false;
    let namedLockAcquired = false;

    const lockReference = transactionReference.toUpperCase();
    const lockName = `mp_payout_ref_${crypto
        .createHash("sha256")
        .update(lockReference)
        .digest("hex")
        .slice(0, 40)}`;

    try {
        const [lockRows] = await conn.execute(
            "SELECT GET_LOCK(?, 10) AS acquired",
            [lockName]
        );

        if (Number(lockRows[0]?.acquired) !== 1) {
            throw new Error("PAYOUT_TRANSACTION_REFERENCE_LOCK_FAILED");
        }

        namedLockAcquired = true;

        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (payout.status !== "processing") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const effectiveProofStorageKey =
            proofStorageKey || payout.payment_proof_key || null;

        const [duplicateRows] = await conn.execute(
            `SELECT id
             FROM marketplace_payout_requests
             WHERE UPPER(TRIM(transaction_reference)) = ?
               AND id <> ?
             LIMIT 1
             FOR UPDATE`,
            [lockReference, payoutId]
        );

        if (duplicateRows.length) {
            throw new Error("PAYOUT_TRANSACTION_REFERENCE_DUPLICATE");
        }

        const items = await getPayoutItemsForUpdate(conn, payoutId);
        assertPayoutItemOwnership(payout, items);

        let itemTotalCents = 0;

        for (const item of items) {
            if (
                item.commission_status !== "payout_requested" ||
                item.status !== "approved"
            ) {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }

            if (String(item.currency) !== String(payout.currency)) {
                throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
            }

            const amount = Math.round(Number(item.amount) * 100);

            if (!Number.isSafeInteger(amount) || amount <= 0) {
                throw new Error("INVALID_PAYOUT_AMOUNT");
            }

            itemTotalCents += amount;

            if (!Number.isSafeInteger(itemTotalCents)) {
                throw new Error("INVALID_PAYOUT_AMOUNT");
            }
        }

        const payoutTotalCents = Math.round(Number(payout.total_amount) * 100);

        if (
            !Number.isSafeInteger(payoutTotalCents) ||
            payoutTotalCents <= 0 ||
            itemTotalCents !== payoutTotalCents
        ) {
            throw new Error("PAYOUT_TOTAL_MISMATCH");
        }

        for (const item of items) {
            const [commissionUpdate] = await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = CASE
                        WHEN reversed_amount >= seller_amount
                            THEN 'reversed'
                        WHEN reversed_amount > 0
                            THEN 'partially_reversed'
                        WHEN paid_amount + ? >= seller_amount
                            THEN 'paid'
                        ELSE 'available'
                     END,
                     paid_amount = paid_amount + ?,
                     paid_at = NOW()
                 WHERE id = ?
                   AND status = 'payout_requested'
                   AND paid_amount + ? + reversed_amount <= seller_amount`,
                [
                    item.amount,
                    item.amount,
                    item.commission_id,
                    item.amount
                ]
            );

            if (commissionUpdate.affectedRows !== 1) {
                throw new Error("PAYOUT_COMMISSION_PAYMENT_CONFLICT");
            }
        }

        const [itemUpdate] = await conn.execute(
            `UPDATE marketplace_payout_items
             SET status = 'paid'
             WHERE payout_request_id = ?
               AND status = 'approved'`,
            [payoutId]
        );

        if (itemUpdate.affectedRows !== items.length) {
            throw new Error("PAYOUT_ITEM_UPDATE_CONFLICT");
        }

        const [payoutUpdate] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'paid',
                 transaction_reference = ?,
                 payment_proof_key = ?,
                 admin_note = COALESCE(?, admin_note),
                 paid_at = NOW(),
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW()
             WHERE id = ?
               AND status = 'processing'`,
            [
                transactionReference,
                effectiveProofStorageKey,
                adminNote || null,
                adminUserId,
                payoutId
            ]
        );

        if (payoutUpdate.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "paid",
            amount: payout.total_amount,
            currency: payout.currency,
            externalReference: transactionReference,
            proofStorageKey: effectiveProofStorageKey,
            note: adminNote || "Payout successfully transferred",
            metadata: {
                previousStatus: "processing",
                newStatus: "paid",
                commissionCount: items.length
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.paid",
            { status: "processing" },
            {
                status: "paid",
                transactionReference,
                proofStorageKey: effectiveProofStorageKey,
                commissionCount: items.length
            },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            status: "paid",
            transactionReference,
            paidAt: new Date()
        };
    } catch (error) {
        if (transactionStarted) {
            await conn.rollback();
            transactionStarted = false;
        }

        if (error.code === "ER_DUP_ENTRY") {
            throw new Error("PAYOUT_TRANSACTION_REFERENCE_DUPLICATE");
        }

        throw error;
    } finally {
        if (namedLockAcquired) {
            try {
                await conn.execute("SELECT RELEASE_LOCK(?)", [lockName]);
            } catch (error) {
                console.error("[PAYOUT LOCK RELEASE ERROR]", error);
            }
        }

        conn.release();
    }
}

async function addPaymentProof(payoutId, adminUserId, proofStorageKey, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    proofStorageKey = cleanText(proofStorageKey, 500);

    if (!proofStorageKey) throw new Error("PAYOUT_PROOF_REQUIRED");

    const note = cleanText(data.note, 2000);
    const originalName = cleanText(data.originalName, 255);
    const mimeType = cleanText(data.mimeType, 100);
    const fileSize = Number(data.fileSize);

    const proofMetadata = {
        originalName: originalName || null,
        mimeType: mimeType || null,
        fileSize: Number.isSafeInteger(fileSize) && fileSize >= 0
            ? fileSize
            : null
    };

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const payout = await getPayoutForUpdate(conn, payoutId);

        if (!["approved", "processing", "paid"].includes(payout.status)) {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        await conn.execute(
            `UPDATE marketplace_payout_requests
             SET payment_proof_key = ?,
                 admin_note = COALESCE(?, admin_note)
             WHERE id = ?`,
            [proofStorageKey, note || null, payoutId]
        );

        await addTransaction(conn, {
            payoutId,
            eventType: "proof_added",
            amount: payout.total_amount,
            currency: payout.currency,
            proofStorageKey,
            note: note || "Payment proof uploaded",
            metadata: {
                payoutStatus: payout.status,
                ...proofMetadata
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.proof_added",
            { paymentProofKey: payout.payment_proof_key || null },
            {
                paymentProofKey: proofStorageKey,
                ...proofMetadata
            },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            paymentProofKey: proofStorageKey
        };
    } catch (error) {
        if (transactionStarted) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getPayoutList,
    getPayoutDetail,
    reviewPayout,
    approvePayout,
    rejectPayout,
    markPayoutProcessing,
    markPayoutPaid,
    addPaymentProof
};
