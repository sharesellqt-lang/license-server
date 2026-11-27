
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


async function getPayoutItems(conn, payoutId, lock = false) {
    const [rows] = await conn.execute(
        `SELECT
            pi.id,
            pi.payout_request_id,
            pi.commission_id,
            pi.amount,
            pi.currency,
            pi.status
         FROM marketplace_payout_items pi
         WHERE pi.payout_request_id = ?
         ORDER BY pi.id ASC
         ${lock ? "FOR UPDATE" : ""}`,
        [payoutId]
    );

    if (!rows.length) {
        throw new Error("PAYOUT_ITEMS_NOT_FOUND");
    }

    return rows;
}

function assertPayoutItemOwnership(payout, items, commissions) {
    const commissionMap = new Map(
        commissions.map(row => [Number(row.id), row])
    );

    for (const item of items) {
        const commission = commissionMap.get(Number(item.commission_id));

        if (
            !commission ||
            Number(commission.seller_id) !== Number(payout.seller_id) ||
            Number(commission.seller_user_id) !== Number(payout.seller_user_id)
        ) {
            throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
        }
    }

    return commissionMap;
}

async function lockPayoutContext(conn, payoutId) {
    // Đọc ban đầu không khóa để xác định các bản ghi liên quan.
    const [payoutRows] = await conn.execute(
        `SELECT *
         FROM marketplace_payout_requests
         WHERE id = ?
         LIMIT 1`,
        [payoutId]
    );

    if (!payoutRows.length) {
        throw new Error("PAYOUT_REQUEST_NOT_FOUND");
    }

    const initialPayout = payoutRows[0];

    const items = await getPayoutItems(conn, payoutId, false);

    const commissionIds = [
        ...new Set(items.map(item => Number(item.commission_id)))
    ].sort((a, b) => a - b);

    if (
        !commissionIds.length ||
        commissionIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    ) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    const placeholders = commissionIds.map(() => "?").join(",");

    // Đọc quan hệ Commission không khóa.
    const [refs] = await conn.execute(
        `SELECT id, order_id, order_item_id
         FROM marketplace_commissions
         WHERE id IN (${placeholders})
         ORDER BY id ASC`,
        commissionIds
    );

    if (refs.length !== commissionIds.length) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    const orderIds = [
        ...new Set(refs.map(row => Number(row.order_id)))
    ].sort((a, b) => a - b);

    const orderItemIds = [
        ...new Set(refs.map(row => Number(row.order_item_id)))
    ].sort((a, b) => a - b);

    if (
        orderIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        orderItemIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    ) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    // 1. Lock Order.
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
        throw new Error("PAYOUT_ORDER_NOT_FOUND");
    }

    const orderMap = new Map(
        orders.map(row => [Number(row.id), row])
    );

    // 2. Lock Order Item.
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
        throw new Error("PAYOUT_ORDER_ITEM_NOT_FOUND");
    }

    const orderItemMap = new Map(
        orderItems.map(row => [Number(row.id), row])
    );

    for (const ref of refs) {
        const orderItem = orderItemMap.get(Number(ref.order_item_id));

        if (
            !orderItem ||
            Number(orderItem.order_id) !== Number(ref.order_id)
        ) {
            throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
        }
    }

    // 3. Lock Commission.
    const [commissions] = await conn.execute(
        `SELECT *
         FROM marketplace_commissions
         WHERE id IN (${placeholders})
         ORDER BY id ASC
         FOR UPDATE`,
        commissionIds
    );

    if (commissions.length !== commissionIds.length) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    const commissionMap = new Map(
        commissions.map(row => [Number(row.id), row])
    );

    // Xác minh quan hệ không thay đổi trong lúc khóa.
    for (const ref of refs) {
        const commission = commissionMap.get(Number(ref.id));

        if (
            !commission ||
            Number(commission.order_id) !== Number(ref.order_id) ||
            Number(commission.order_item_id) !== Number(ref.order_item_id) ||
            Number(commission.seller_id) !== Number(initialPayout.seller_id) ||
            Number(commission.seller_user_id) !== Number(initialPayout.seller_user_id)
        ) {
            throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
        }
    }

    // 4. Lock Delivery.
    const [deliveries] = await conn.execute(
        `SELECT id, order_item_id, status
         FROM marketplace_deliveries
         WHERE order_item_id IN (${itemPlaceholders})
         ORDER BY id ASC
         FOR UPDATE`,
        orderItemIds
    );

    const deliveryMap = new Map();

    for (const delivery of deliveries) {
        const key = Number(delivery.order_item_id);

        // Nếu DB có nhiều Delivery cho một Order Item,
        // không tự ý chọn bản ghi bất kỳ.
        if (deliveryMap.has(key)) {
            throw new Error("PAYOUT_DELIVERY_INTEGRITY_ERROR");
        }

        deliveryMap.set(key, delivery);
    }

    // 5. Lock tất cả Commission Hold active.
    const [holds] = await conn.execute(
        `SELECT id, commission_id, hold_type, reference_type, reference_id
         FROM marketplace_commission_holds
         WHERE commission_id IN (${placeholders})
           AND status = 'active'
         ORDER BY id ASC
         FOR UPDATE`,
        commissionIds
    );

    // 6. Lock Ticket active thuộc các Order liên quan.
    const [tickets] = await conn.execute(
        `SELECT id, order_id, order_item_id, seller_user_id, status
         FROM marketplace_support_tickets
         WHERE seller_user_id = ?
           AND order_id IN (${orderPlaceholders})
           AND status IN (${ACTIVE_TICKET_STATUSES.map(() => "?").join(",")})
           AND (
                order_item_id IS NULL
                OR order_item_id IN (${itemPlaceholders})
           )
         ORDER BY id ASC
         FOR UPDATE`,
        [
            initialPayout.seller_user_id,
            ...orderIds,
            ...ACTIVE_TICKET_STATUSES,
            ...orderItemIds
        ]
    );

    // 7. Cuối cùng mới khóa Payout Request.
    const payout = await getPayoutForUpdate(conn, payoutId);

    if (
        Number(payout.seller_id) !== Number(initialPayout.seller_id) ||
        Number(payout.seller_user_id) !== Number(initialPayout.seller_user_id)
    ) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    // 8. Khóa Payout Items.
    const lockedItems = await getPayoutItems(conn, payoutId, true);

    if (
        lockedItems.length !== items.length ||
        lockedItems.some((item, index) =>
            Number(item.id) !== Number(items[index].id) ||
            Number(item.commission_id) !== Number(items[index].commission_id)
        )
    ) {
        throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
    }

    return {
        payout,
        items: lockedItems,
        commissions,
        commissionMap,
        orders,
        orderMap,
        orderItems,
        orderItemMap,
        deliveries,
        deliveryMap,
        holds,
        tickets
    };
}

function assertPayoutFinancialEligibility(context) {
    for (const commission of context.commissions) {
        const order = context.orderMap.get(Number(commission.order_id));

        if (
            !order ||
            order.payment_status !== "paid" ||
            [
                "cancelled",
                "disputed",
                "refunded",
                "partially_refunded"
            ].includes(order.order_status)
        ) {
            throw new Error("PAYOUT_ORDER_NOT_ELIGIBLE");
        }

        const delivery = context.deliveryMap.get(
            Number(commission.order_item_id)
        );

        if (
            !delivery ||
            !["delivered", "confirmed"].includes(delivery.status)
        ) {
            throw new Error("PAYOUT_DELIVERY_NOT_COMPLETED");
        }

        if (commission.status !== "payout_requested") {
            throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
        }
    }

    if (context.holds.length) {
        throw new Error("PAYOUT_COMMISSION_ON_HOLD");
    }

    if (context.tickets.length) {
        throw new Error("PAYOUT_COMMISSION_HAS_ACTIVE_TICKET");
    }
}

async function safeRollback(conn, transactionStarted) {
    if (!transactionStarted) return;

    try {
        await conn.rollback();
    } catch (rollbackError) {
        console.error(
            "[MarketplacePayoutAdmin] Rollback failed:",
            rollbackError
        );
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

        // Lock theo thứ tự:
        // Order -> Order Item -> Commission -> Delivery
        // -> Commission Hold -> Support Ticket
        // -> Payout Request -> Payout Items.
        const context = await lockPayoutContext(conn, payoutId);
        const { payout, items, commissions } = context;

        if (payout.status !== "under_review") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        assertPayoutItemOwnership(
            payout,
            items,
            commissions
        );

        // Không duyệt nếu Order, Payment, Delivery,
        // Commission Hold hoặc Support Ticket không hợp lệ.
        assertPayoutFinancialEligibility(context);

        for (const item of items) {
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
            [
                adminNote || payout.admin_note,
                adminUserId,
                payoutId
            ]
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
            metadata: {
                previousStatus: "under_review",
                newStatus: "approved",
                commissionCount: commissions.length
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.approved",
            {
                status: "under_review"
            },
            {
                status: "approved",
                adminNote
            },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            status: "approved"
        };
    } catch (error) {
        await safeRollback(conn, transactionStarted);
        transactionStarted = false;
        throw error;
    } finally {
        conn.release();
    }
}



async function restoreCommissionAfterRejection(conn, commission, context) {
    const commissionId = Number(commission.id);
    const order = context.orderMap.get(Number(commission.order_id));

    if (!order) {
        throw new Error("PAYOUT_ORDER_NOT_FOUND");
    }

    // Commission đã được một luồng khác chuyển sang on_hold.
    // Không tự ý ghi đè trạng thái này khi Admin từ chối Payout.
    if (commission.status === "on_hold") {
        return {
            commissionId,
            status: "on_hold",
            reason: "existing_commission_hold"
        };
    }

    if (commission.status !== "payout_requested") {
        throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
    }

    const orderIsRisky =
        order.payment_status !== "paid" ||
        [
            "cancelled",
            "disputed",
            "refunded",
            "partially_refunded"
        ].includes(order.order_status);

    const hasActiveHold = context.holds.some(
        hold => Number(hold.commission_id) === commissionId
    );

    const hasActiveTicket = context.tickets.some(ticket =>
        Number(ticket.order_id) === Number(commission.order_id) &&
        Number(ticket.seller_user_id) === Number(commission.seller_user_id) &&
        (
            ticket.order_item_id == null ||
            Number(ticket.order_item_id) === Number(commission.order_item_id)
        )
    );

    let nextStatus = "available";
    let reason = "eligible";

    if (orderIsRisky) {
        nextStatus = "on_hold";
        reason = "order_not_eligible";
    } else if (hasActiveHold) {
        nextStatus = "on_hold";
        reason = "active_commission_hold";
    } else if (hasActiveTicket) {
        nextStatus = "on_hold";
        reason = "active_support_ticket";
    } else {
        const eligibleAt = commission.eligible_at
            ? new Date(commission.eligible_at).getTime()
            : NaN;

        if (!Number.isFinite(eligibleAt) || eligibleAt > Date.now()) {
            nextStatus = "pending_protection";
            reason = "protection_not_completed";
        }
    }

    const [result] = await conn.execute(
        `UPDATE marketplace_commissions
         SET status = ?
         WHERE id = ?
           AND status = 'payout_requested'`,
        [nextStatus, commissionId]
    );

    if (result.affectedRows !== 1) {
        throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
    }

    return {
        commissionId,
        status: nextStatus,
        reason
    };
}



async function rejectPayout(payoutId, adminUserId, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    const rejectionReason = cleanText(data.rejectionReason, 2000);
    const adminNote = cleanText(data.adminNote, 2000);

    if (!rejectionReason) {
        throw new Error("PAYOUT_REJECTION_REASON_REQUIRED");
    }

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        // Lock theo thứ tự chung:
        // Order -> Order Item -> Commission -> Delivery
        // -> Hold -> Ticket -> Payout -> Payout Items.
        const context = await lockPayoutContext(conn, payoutId);
        const { payout, items, commissions } = context;

        if (!["pending", "under_review", "approved"].includes(payout.status)) {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        assertPayoutItemOwnership(
            payout,
            items,
            commissions
        );

        const commissionMap = new Map(
            commissions.map(commission => [
                Number(commission.id),
                commission
            ])
        );

        const restoredCommissions = [];

        for (const item of items) {
            const commission = commissionMap.get(
                Number(item.commission_id)
            );

            if (!commission) {
                throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
            }

            if (
                !["payout_requested", "on_hold"].includes(commission.status)
            ) {
                throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
            }

            if (!["requested", "approved"].includes(item.status)) {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }

            restoredCommissions.push(
                await restoreCommissionAfterRejection(
                    conn,
                    commission,
                    context
                )
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
                adminNote || null,
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
            {
                status: payout.status
            },
            {
                status: "rejected",
                rejectionReason,
                adminNote,
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
        await safeRollback(conn, transactionStarted);
        transactionStarted = false;
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

        // Khóa dữ liệu theo thứ tự thống nhất toàn Marketplace.
        const context = await lockPayoutContext(conn, payoutId);
        const { payout, items, commissions } = context;

        if (payout.status !== "approved") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        assertPayoutItemOwnership(
            payout,
            items,
            commissions
        );

        // Kiểm tra lại Order, Payment, Delivery,
        // Commission Hold và Support Ticket.
        assertPayoutFinancialEligibility(context);

        for (const item of items) {
            if (item.status !== "approved") {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }
        }

        const [result] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET status = 'processing',
                 admin_note = COALESCE(?, admin_note)
             WHERE id = ?
               AND status = 'approved'`,
            [
                adminNote || null,
                payoutId
            ]
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
            metadata: {
                previousStatus: "approved",
                newStatus: "processing",
                commissionCount: commissions.length
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.processing",
            {
                status: "approved"
            },
            {
                status: "processing",
                adminNote
            },
            audit
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: payoutId,
            status: "processing"
        };
    } catch (error) {
        await safeRollback(conn, transactionStarted);
        transactionStarted = false;
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

    // Chuyển DECIMAL thành cent bằng BigInt để tránh sai số float.
    function toCents(value) {
        const text = String(value ?? "").trim();

        if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
            throw new Error("INVALID_PAYOUT_AMOUNT");
        }

        const [whole, fraction = ""] = text.split(".");
        const cents =
            BigInt(whole) * 100n +
            BigInt(fraction.padEnd(2, "0"));

        if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("INVALID_PAYOUT_AMOUNT");
        }

        return cents;
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
        // Serialize các yêu cầu sử dụng cùng transaction reference.
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

        // Lock Order -> Order Item -> Commission -> Delivery
        // -> Hold -> Ticket -> Payout -> Payout Item.
        const context = await lockPayoutContext(conn, payoutId);
        const { payout, items, commissions } = context;

        if (payout.status !== "processing") {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        assertPayoutItemOwnership(
            payout,
            items,
            commissions
        );

        const effectiveProofStorageKey =
            proofStorageKey || payout.payment_proof_key || null;

        // Kiểm tra trùng mã giao dịch.
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

        if (!items.length) {
            throw new Error("PAYOUT_ITEMS_NOT_FOUND");
        }

        const commissionMap = new Map(
            commissions.map(commission => [
                Number(commission.id),
                commission
            ])
        );

        let itemTotalCents = 0n;

        for (const item of items) {
            if (item.status !== "approved") {
                throw new Error("PAYOUT_ITEM_STATE_CHANGED");
            }

            if (String(item.currency) !== String(payout.currency)) {
                throw new Error("PAYOUT_ITEMS_INTEGRITY_ERROR");
            }

            const commission = commissionMap.get(
                Number(item.commission_id)
            );

            if (
                !commission ||
                !["payout_requested", "on_hold"].includes(commission.status)
            ) {
                throw new Error("PAYOUT_COMMISSION_STATE_CHANGED");
            }

            itemTotalCents += toCents(item.amount);

            if (itemTotalCents > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error("INVALID_PAYOUT_AMOUNT");
            }
        }

        const payoutTotalCents = toCents(payout.total_amount);

        if (itemTotalCents !== payoutTotalCents) {
            throw new Error("PAYOUT_TOTAL_MISMATCH");
        }

        // Xác định các điều kiện khiến Commission phải tiếp tục bị giữ.
        // Không chặn việc ghi nhận tiền nếu Finance đã thực sự chuyển khoản.
        for (const item of items) {
            const commission = commissionMap.get(
                Number(item.commission_id)
            );

            const order = context.orderMap.get(
                Number(commission.order_id)
            );

            if (!order) {
                throw new Error("PAYOUT_ORDER_NOT_FOUND");
            }

            const orderIsRisky =
                order.payment_status !== "paid" ||
                [
                    "cancelled",
                    "disputed",
                    "refunded",
                    "partially_refunded"
                ].includes(order.order_status);

            const hasActiveHold = context.holds.some(
                hold =>
                    Number(hold.commission_id) === Number(commission.id)
            );

            const hasActiveTicket = context.tickets.some(ticket =>
                Number(ticket.order_id) === Number(commission.order_id) &&
                Number(ticket.seller_user_id) === Number(commission.seller_user_id) &&
                (
                    ticket.order_item_id == null ||
                    Number(ticket.order_item_id) === Number(commission.order_item_id)
                )
            );

            const delivery = context.deliveryMap.get(
                Number(commission.order_item_id)
            );

            const deliveryIncomplete =
                !delivery ||
                !["delivered", "confirmed"].includes(delivery.status);

            const mustRemainOnHold =
                commission.status === "on_hold" ||
                orderIsRisky ||
                hasActiveHold ||
                hasActiveTicket ||
                deliveryIncomplete;

            const [commissionUpdate] = await conn.execute(
                `UPDATE marketplace_commissions
                 SET paid_amount = paid_amount + ?,
                     status = CASE
                         WHEN reversed_amount >= seller_amount
                             THEN 'reversed'
                         WHEN reversed_amount > 0
                             THEN 'partially_reversed'
                         WHEN paid_amount + ? >= seller_amount
                             THEN 'paid'
                         WHEN ? = 1
                             THEN 'on_hold'
                         ELSE 'available'
                     END,
                     paid_at = NOW()
                 WHERE id = ?
                   AND status IN ('payout_requested', 'on_hold')
                   AND paid_amount + ? + reversed_amount <= seller_amount`,
                [
                    item.amount,
                    item.amount,
                    mustRemainOnHold ? 1 : 0,
                    commission.id,
                    item.amount
                ]
            );

            if (commissionUpdate.affectedRows !== 1) {
                throw new Error("PAYOUT_COMMISSION_PAYMENT_CONFLICT");
            }
        }

        // Đánh dấu tất cả Payout Items đã thanh toán.
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

        // Cập nhật Payout Request.
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
                commissionCount: items.length,
                transactionReference
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.paid",
            {
                status: "processing"
            },
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
        await safeRollback(conn, transactionStarted);
        transactionStarted = false;

        if (error.code === "ER_DUP_ENTRY") {
            const duplicateError = new Error(
                "PAYOUT_TRANSACTION_REFERENCE_DUPLICATE"
            );
            duplicateError.code = "PAYOUT_TRANSACTION_REFERENCE_DUPLICATE";
            throw duplicateError;
        }

        throw error;
    } finally {
        if (namedLockAcquired) {
            try {
                await conn.execute(
                    "SELECT RELEASE_LOCK(?)",
                    [lockName]
                );
            } catch (error) {
                console.error(
                    "[PAYOUT LOCK RELEASE ERROR]",
                    error
                );
            }
        }

        conn.release();
    }
}



async function addPaymentProof(payoutId, adminUserId, proofStorageKey, data = {}, audit = {}) {
    payoutId = positiveId(payoutId, "INVALID_PAYOUT_ID");
    adminUserId = positiveId(adminUserId, "INVALID_ADMIN_USER_ID");

    proofStorageKey = cleanText(proofStorageKey, 500);

    if (!proofStorageKey) {
        throw new Error("PAYOUT_PROOF_REQUIRED");
    }

    const note = cleanText(data.note, 2000);
    const originalName = cleanText(data.originalName, 255);
    const mimeType = cleanText(data.mimeType, 100);
    const fileSize = Number(data.fileSize);

    if (
        data.fileSize !== undefined &&
        data.fileSize !== null &&
        data.fileSize !== "" &&
        (!Number.isSafeInteger(fileSize) || fileSize < 0)
    ) {
        throw new Error("PAYOUT_PROOF_INVALID_FILE_SIZE");
    }

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

        // Chứng từ thanh toán chỉ được thêm hoặc thay đổi
        // trước khi Payout chuyển sang paid.
        if (!["approved", "processing"].includes(payout.status)) {
            throw new Error("PAYOUT_INVALID_STATUS_TRANSITION");
        }

        const [result] = await conn.execute(
            `UPDATE marketplace_payout_requests
             SET payment_proof_key = ?,
                 admin_note = COALESCE(?, admin_note)
             WHERE id = ?
               AND status IN ('approved', 'processing')`,
            [
                proofStorageKey,
                note || null,
                payoutId
            ]
        );

        if (result.affectedRows !== 1) {
            throw new Error("PAYOUT_STATUS_CHANGED");
        }

        await addTransaction(conn, {
            payoutId,
            eventType: "proof_added",
            amount: payout.total_amount,
            currency: payout.currency,
            proofStorageKey,
            note: note || "Payment proof uploaded",
            metadata: {
                payoutStatus: payout.status,
                previousProofKey: payout.payment_proof_key || null,
                ...proofMetadata
            },
            adminUserId
        });

        await writePayoutAudit(
            conn,
            payout,
            adminUserId,
            "marketplace.payout.proof_added",
            {
                paymentProofKey: payout.payment_proof_key || null
            },
            {
                paymentProofKey: proofStorageKey,
                payoutStatus: payout.status,
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
        await safeRollback(conn, transactionStarted);
        transactionStarted = false;
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
