
"use strict";

const crypto = require("crypto");
const db = require("../db");
const rewardService = require("./rewards.ledger.service");

const CREDIT_RATE = 1n;

// =====================================================
// VALIDATION
// =====================================================

function positiveId(value, error = "INVALID_AFFILIATE_ORDER_ID") {
    const id = String(value ?? "").trim();

    if (!/^[1-9]\d*$/.test(id)) {
        throw new Error(error);
    }

    return id;
}

function parsePayout(value) {
    if (value == null || value === "") return 0n;

    const normalized = String(value).trim().replace(/,/g, "");

    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error("INVALID_AFFILIATE_PAYOUT");
    }

    const [integerPart, decimalPart = ""] = normalized.split(".");

    if (/[1-9]/.test(decimalPart)) {
        throw new Error("INVALID_AFFILIATE_PAYOUT_PRECISION");
    }

    return BigInt(integerPart) * CREDIT_RATE;
}

function parseCommissionTotal(value) {
    if (value == null || value === "") return 0n;

    const normalized = String(value).trim();

    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error("INVALID_AFFILIATE_COMMISSION_TOTAL");
    }

    const [integerPart, decimalPart = ""] = normalized.split(".");

    if (/[1-9]/.test(decimalPart)) {
        throw new Error("INVALID_AFFILIATE_COMMISSION_TOTAL");
    }

    return BigInt(integerPart);
}

// =====================================================
// HASH / IDEMPOTENCY
// =====================================================

function makeHash(data) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
}

function makeIdempotencyKey(eventHash) {
    return `affiliate:${eventHash}`;
}

function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
}

// =====================================================
// ORDER STATUS
// =====================================================

function isTerminallyRejectedOrder(order) {
    const rejectedStatuses = [
        "cancelled",
        "canceled",
        "returned",
        "rejected",
        "invalid"
    ];

    return (
        rejectedStatuses.includes(normalizeStatus(order.order_status)) ||
        rejectedStatuses.includes(normalizeStatus(order.payment_status)) ||
        rejectedStatuses.includes(normalizeStatus(order.validity)) ||
        Boolean(order.returned_time)
    );
}

function isConfirmedOrder(order) {
    return (
        normalizeStatus(order.payment_status) === "paid" &&
        normalizeStatus(order.validity) === "valid" &&
        !isTerminallyRejectedOrder(order)
    );
}

// =====================================================
// ORDER DATA
// =====================================================

async function getOrderForCommission(conn, orderId) {
    const [rows] = await conn.execute(
        `SELECT
            o.*,
            c.user_id AS attributed_user_id,
            c.attribution_status AS click_attribution_status
         FROM affiliate_orders o
         LEFT JOIN affiliate_clicks c
            ON c.id = o.click_id
         WHERE o.id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderId]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_ORDER_NOT_FOUND");
    }

    return rows[0];
}

// =====================================================
// COMMISSION TOTAL
// =====================================================

async function getCommissionTotal(conn, orderId) {
    const [rows] = await conn.execute(
        `SELECT
            COALESCE(SUM(
                CASE
                    WHEN event_type IN ('commission', 'adjustment')
                     AND status = 'confirmed'
                    THEN amount

                    WHEN event_type = 'reversal'
                     AND status = 'confirmed'
                    THEN -amount

                    ELSE 0
                END
            ), 0) AS total
         FROM affiliate_commissions
         WHERE order_id = ?`,
        [orderId]
    );

    return parseCommissionTotal(rows[0]?.total);
}

// =====================================================
// CHECK OUTSTANDING RECOVERY
// =====================================================

async function hasOutstandingRecovery(conn, orderId) {
    const [rows] = await conn.execute(
        `SELECT id
         FROM affiliate_credit_recoveries
         WHERE order_id = ?
           AND status IN ('pending', 'partial')
           AND recovered_amount < amount
         LIMIT 1`,
        [orderId]
    );

    return rows.length > 0;
}

// =====================================================
// COMMISSION EVENT
// =====================================================

async function createCommissionEvent(conn, data) {
    const eventHash = makeHash({
        networkId: String(data.networkId),
        orderId: String(data.orderId),
        eventType: data.eventType,
        amount: data.amount.toString(),
        sourceVersion: data.sourceVersion
    });

    const [existing] = await conn.execute(
        `SELECT id, reward_transaction_id
         FROM affiliate_commissions
         WHERE network_id = ?
           AND source_record_hash = ?
         LIMIT 1
         FOR UPDATE`,
        [data.networkId, eventHash]
    );

    if (existing.length) {
        return {
            duplicate: true,
            commissionId: String(existing[0].id),
            rewardTransactionId: existing[0].reward_transaction_id,
            eventHash
        };
    }

    const [result] = await conn.execute(
        `INSERT INTO affiliate_commissions (
            network_id,
            order_id,
            event_type,
            amount,
            currency,
            status,
            source_record_hash
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [
            data.networkId,
            data.orderId,
            data.eventType,
            data.amount.toString(),
            data.currency || "VND",
            eventHash
        ]
    );

    return {
        duplicate: false,
        commissionId: String(result.insertId),
        eventHash
    };
}

// =====================================================
// CREATE RECOVERY AND COLLECT AVAILABLE CREDITS
// =====================================================

async function createAndCollectRecovery(conn, data) {
    const userId = Number(data.userId);
    const amount = BigInt(data.amount);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    if (amount <= 0n) {
        throw new Error("INVALID_RECOVERY_AMOUNT");
    }

    // Lock wallet trước recovery để thống nhất thứ tự khóa.
    await conn.execute(
        `INSERT IGNORE INTO reward_wallets (user_id)
         VALUES (?)`,
        [userId]
    );

    const [walletRows] = await conn.execute(
        `SELECT id, user_id, balance, status
         FROM reward_wallets
         WHERE user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [userId]
    );

    if (!walletRows.length) {
        throw new Error("WALLET_NOT_FOUND");
    }

    const wallet = walletRows[0];

        if (wallet.status !== "active") {
            throw new Error("WALLET_LOCKED");
        }

    // Tìm recovery theo commission.
    const [recoveryRows] = await conn.execute(
        `SELECT *
         FROM affiliate_credit_recoveries
         WHERE commission_id = ?
         LIMIT 1
         FOR UPDATE`,
        [data.commissionId]
    );

    let recovery;

    if (recoveryRows.length) {
        recovery = recoveryRows[0];

        if (
            Number(recovery.user_id) !== userId ||
            String(recovery.order_id) !== String(data.orderId)
        ) {
            throw new Error("AFFILIATE_RECOVERY_CONFLICT");
        }

        const recovered = BigInt(recovery.recovered_amount);

        if (amount < recovered) {
            throw new Error("AFFILIATE_RECOVERY_AMOUNT_BELOW_RECOVERED");
        }

        const status = amount === recovered
            ? "recovered"
            : recovered > 0n
                ? "partial"
                : "pending";

        await conn.execute(
            `UPDATE affiliate_credit_recoveries
             SET amount = ?,
                 status = ?
             WHERE id = ?`,
            [
                amount.toString(),
                status,
                recovery.id
            ]
        );

        recovery.amount = amount.toString();
        recovery.status = status;
    } else {
        const [insertResult] = await conn.execute(
            `INSERT INTO affiliate_credit_recoveries (
                user_id,
                order_id,
                commission_id,
                amount,
                recovered_amount,
                status
            ) VALUES (?, ?, ?, ?, 0, 'pending')`,
            [
                userId,
                data.orderId,
                data.commissionId,
                amount.toString()
            ]
        );

        recovery = {
            id: insertResult.insertId,
            user_id: userId,
            order_id: data.orderId,
            commission_id: data.commissionId,
            amount: amount.toString(),
            recovered_amount: "0",
            status: "pending"
        };
    }

    const recoveredBefore = BigInt(recovery.recovered_amount);
    const remaining = amount - recoveredBefore;

 if (remaining <= 0n) {
    return {
        recoveryId: String(recovery.id),
        amount: amount.toString(),
        recoveredAmount: recoveredBefore.toString(),
        remainingAmount: remaining.toString(),
        status: "recovered",
        rewardTransactionId: null
    };
}
    const balance = BigInt(wallet.balance);
    const collectAmount = balance < remaining
        ? balance
        : remaining;

    if (collectAmount <= 0n) {
        return {
            recoveryId: String(recovery.id),
            amount: amount.toString(),
            recoveredAmount: recoveredBefore.toString(),
            remainingAmount: remaining.toString(),
            status: recovery.status,
            rewardTransactionId: null
        };
    }

    const recoveredAfter = recoveredBefore + collectAmount;

    const idempotencyKey =
        `affiliate:recovery:${recovery.id}:${recoveredAfter}`;

    const rewardResult = await rewardService.reverseCreditWithConnection(
        conn,
        {
            userId,
            amount: collectAmount.toString(),
            idempotencyKey,
            referenceType: "affiliate_credit_recovery",
            referenceId: String(recovery.id),
            description: "Thu hồi Credits hoa hồng Affiliate",
            metadata: {
                orderId: String(data.orderId),
                commissionId: String(data.commissionId),
                recoveryId: String(recovery.id)
            }
        }
    );

    const status = recoveredAfter >= amount
        ? "recovered"
        : "partial";

    await conn.execute(
        `UPDATE affiliate_credit_recoveries
         SET recovered_amount = ?,
             status = ?
         WHERE id = ?`,
        [
            recoveredAfter.toString(),
            status,
            recovery.id
        ]
    );

    return {
        recoveryId: String(recovery.id),
        amount: amount.toString(),
        recoveredAmount: recoveredAfter.toString(),
        remainingAmount: (amount - recoveredAfter).toString(),
        status,
        rewardTransactionId: rewardResult.transactionId
    };
}

// =====================================================
// PROCESS ORDER COMMISSION
// =====================================================

async function processOrderCommission(orderId) {
    orderId = positiveId(orderId);

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const order = await getOrderForCommission(conn, orderId);

        if (
            !order.click_id ||
            !order.attributed_user_id ||
            order.click_attribution_status !== "verified"
        ) {
            throw new Error("AFFILIATE_ORDER_NOT_ATTRIBUTED");
        }

        if (
            String(order.currency || "").trim().toUpperCase() !== "VND"
        ) {
            throw new Error("UNSUPPORTED_AFFILIATE_CURRENCY");
        }

        const currentTotal = await getCommissionTotal(conn, order.id);

        if (currentTotal < 0n) {
            throw new Error("INVALID_AFFILIATE_COMMISSION_TOTAL");
        }

        let targetAmount = 0n;

        if (isTerminallyRejectedOrder(order)) {
            targetAmount = 0n;
        } else if (isConfirmedOrder(order)) {
            targetAmount = parsePayout(order.payout);
        } else {
            throw new Error("AFFILIATE_COMMISSION_NOT_CONFIRMED");
        }

        const difference = targetAmount - currentTotal;

        if (difference === 0n) {
            await conn.commit();

            return {
                success: true,
                duplicate: true,
                message: "Hoa hồng đã được xử lý",
                totalCredits: currentTotal.toString()
            };
        }

        // Không tự động cộng lại hoa hồng nếu vẫn còn
        // khoản thu hồi cũ chưa được xử lý xong.
        // Tránh cấp sai Credits khi trạng thái đơn thay đổi ngược.
        if (
            difference > 0n &&
            await hasOutstandingRecovery(conn, order.id)
        ) {
            throw new Error("AFFILIATE_RECOVERY_RECONCILIATION_REQUIRED");
        }

        const eventType = difference > 0n
            ? (currentTotal === 0n ? "commission" : "adjustment")
            : "reversal";

        const amount = difference > 0n
            ? difference
            : -difference;

        const event = await createCommissionEvent(conn, {
            networkId: order.network_id,
            orderId: order.id,
            eventType,
            amount,
            currency: order.currency,
            sourceVersion: {
                payout: String(order.payout ?? "0"),
                paymentStatus: order.payment_status,
                validity: order.validity,
                orderStatus: order.order_status,
                returnedTime: order.returned_time || null,
                updatedAt: order.updated_at || null
            }
        });

        if (event.duplicate) {
            throw new Error("AFFILIATE_COMMISSION_EVENT_DUPLICATE");
        }

        const commissionId = event.commissionId;
        const idempotencyKey = makeIdempotencyKey(event.eventHash);

        let rewardTransactionId = null;
        let recoveryResult = null;

        if (difference > 0n) {
            const rewardResult = await rewardService.creditWalletWithConnection(
                conn,
                {
                    userId: order.attributed_user_id,
                    amount: amount.toString(),
                    source: "affiliate",
                    idempotencyKey,
                    referenceType: "affiliate_commission",
                    referenceId: commissionId,
                    description: "Credits hoa hồng Affiliate",
                    metadata: {
                        orderId: String(order.id),
                        commissionId,
                        eventType,
                        currency: order.currency,
                        payout: String(order.payout)
                    }
                }
            );

            if (!rewardResult || !rewardResult.transactionId) {
                throw new Error("AFFILIATE_REWARD_TRANSACTION_FAILED");
            }

            rewardTransactionId = rewardResult.transactionId;
        } else {
            recoveryResult = await createAndCollectRecovery(conn, {
                userId: order.attributed_user_id,
                orderId: order.id,
                commissionId,
                amount
            });

            rewardTransactionId =
                recoveryResult.rewardTransactionId || null;
        }

        // Sự kiện commission đã được ghi nhận.
        // Với reversal, reward_transaction_id có thể NULL
        // nếu chưa thu hồi được Credits nào.
        await conn.execute(
            `UPDATE affiliate_commissions
             SET status = 'confirmed',
                 reward_transaction_id = ?,
                 processed_at = NOW()
             WHERE id = ?
               AND status = 'pending'`,
            [
                rewardTransactionId,
                commissionId
            ]
        );

        await conn.commit();

        return {
            success: true,
            duplicate: false,
            commissionId,
            rewardTransactionId,
            eventType,
            amount: amount.toString(),
            totalCredits: targetAmount.toString(),
            recovery: recoveryResult
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    processOrderCommission
};
