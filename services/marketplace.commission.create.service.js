
"use strict";

const ACTIVE_TICKET_STATUSES = [
    "open",
    "waiting_seller",
    "waiting_buyer",
    "under_review"
];

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function toCents(value) {
    const input = String(value ?? "").trim();
    if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(input)) {
        fail("INVALID_COMMISSION_AMOUNT");
    }

    const [whole, fraction = ""] = input.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function toRateBasisPoints(value) {
    const input = String(value ?? "").trim();
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(input)) {
        fail("INVALID_COMMISSION_RATE");
    }

    const [whole, fraction = ""] = input.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function moneyString(cents) {
    const whole = cents / 100n;
    const fraction = String(cents % 100n).padStart(2, "0");
    return `${whole}.${fraction}`;
}

async function createCommissionForDeliveredItem(
    conn,
    item,
    delivery,
    actorUserId = null
) {
    const orderId = Number(item.order_id);
    const orderItemId = Number(item.id);
    const deliveryId = Number(delivery.id);

    if (!orderId || !orderItemId || !deliveryId) {
        fail("INVALID_COMMISSION_SOURCE");
    }

    if (item.payment_status !== "paid") {
        fail("ORDER_NOT_PAID");
    }

    if (
        ["cancelled", "disputed", "refunded"].includes(item.order_status)
    ) {
        fail("ORDER_NOT_COMMISSIONABLE");
    }

    if (!delivery.protection_started_at || !delivery.protection_ends_at) {
        fail("DELIVERY_PROTECTION_SNAPSHOT_MISSING");
    }

    if (
        delivery.protection_days === null ||
        delivery.protection_days === undefined ||
        !Number.isInteger(Number(delivery.protection_days)) ||
        Number(delivery.protection_days) < 0
    ) {
        fail("DELIVERY_PROTECTION_DAYS_MISSING");
    }

    if (
        delivery.seller_rate === null ||
        delivery.platform_rate === null
    ) {
        fail("DELIVERY_COMMISSION_RATE_MISSING");
    }

    const sellerRate = toRateBasisPoints(delivery.seller_rate);
    const platformRate = toRateBasisPoints(delivery.platform_rate);

    if (
        sellerRate < 0n ||
        platformRate < 0n ||
        sellerRate + platformRate !== 10000n
    ) {
        fail("INVALID_COMMISSION_RATE");
    }

    const [existing] = await conn.execute(
        `SELECT id
         FROM marketplace_commissions
         WHERE order_item_id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderItemId]
    );

    if (existing.length) {
        return {
            commissionId: Number(existing[0].id),
            created: false
        };
    }

    const placeholders = ACTIVE_TICKET_STATUSES.map(() => "?").join(",");

    const [tickets] = await conn.execute(
        `SELECT id
         FROM marketplace_support_tickets
         WHERE order_id = ?
           AND status IN (${placeholders})
           AND (order_item_id = ? OR order_item_id IS NULL)
         ORDER BY id ASC
         FOR UPDATE`,
        [orderId, ...ACTIVE_TICKET_STATUSES, orderItemId]
    );

    const commissionableCents = toCents(item.line_total);
    const sellerCents = (
        commissionableCents * sellerRate + 5000n
    ) / 10000n;
    const platformCents = commissionableCents - sellerCents;

    const initialStatus = tickets.length
        ? "on_hold"
        : "pending_protection";

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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            orderId,
            orderItemId,
            item.seller_id,
            item.seller_user_id,
            moneyString(commissionableCents),
            item.currency,
            String(delivery.seller_rate),
            String(delivery.platform_rate),
            moneyString(sellerCents),
            moneyString(platformCents),
            Number(delivery.protection_days),
            delivery.protection_started_at,
            delivery.protection_ends_at,
            delivery.protection_ends_at,
            initialStatus
        ]
    );

    const commissionId = Number(result.insertId);

    for (const ticket of tickets) {
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
                commissionId,
                String(ticket.id),
                "Support Ticket đang hoạt động tại thời điểm tạo Commission",
                actorUserId || null
            ]
        );
    }

    return {
        commissionId,
        created: true,
        status: initialStatus
    };
}

module.exports = {
    createCommissionForDeliveredItem
};
