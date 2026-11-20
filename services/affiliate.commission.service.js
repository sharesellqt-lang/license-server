
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

    const normalized = String(value)
        .trim()
        .replace(/,/g, "");

    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error("INVALID_AFFILIATE_PAYOUT");
    }

    const [integerPart, decimalPart = ""] = normalized.split(".");

    // Credits được tính theo đơn vị VND nguyên.
    // Không tự ý làm tròn hoặc cắt bỏ phần thập phân.
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

// =====================================================
// ORDER STATUS
// =====================================================

function normalizeStatus(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isTerminallyRejectedOrder(order) {
    const paymentStatus = normalizeStatus(order.payment_status);
    const validity = normalizeStatus(order.validity);
    const orderStatus = normalizeStatus(order.order_status);

    const rejectedStatuses = [
        "cancelled",
        "canceled",
        "returned",
        "rejected",
        "invalid"
    ];

    if (rejectedStatuses.includes(orderStatus)) return true;
    if (rejectedStatuses.includes(paymentStatus)) return true;
    if (rejectedStatuses.includes(validity)) return true;
    if (order.returned_time) return true;

    return false;
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
        `SELECT
            id,
            reward_transaction_id
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
// PROCESS ORDER COMMISSION
// =====================================================

async function processOrderCommission(orderId) {
    orderId = positiveId(orderId);

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const order = await getOrderForCommission(conn, orderId);

        // Phải xác định đúng thành viên trước khi cấp hoặc thu hồi.
        if (
            !order.click_id ||
            !order.attributed_user_id ||
            order.click_attribution_status !== "verified"
        ) {
            throw new Error("AFFILIATE_ORDER_NOT_ATTRIBUTED");
        }

        // Chỉ hỗ trợ VND trong phiên bản hiện tại.
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
            // Đơn bị hủy hoặc hoàn trả:
            // mục tiêu hoa hồng bằng 0.
            targetAmount = 0n;
        } else if (isConfirmedOrder(order)) {
            targetAmount = parsePayout(order.payout);
        } else {
            // Đơn chưa được Lazada xác nhận:
            // không cấp và không thu hồi Credits.
            throw new Error("AFFILIATE_COMMISSION_NOT_CONFIRMED");
        }

        const difference = targetAmount - currentTotal;

        // Không có chênh lệch: không tạo event,
        // không phát sinh giao dịch Credits.
        if (difference === 0n) {
            await conn.commit();

            return {
                success: true,
                duplicate: true,
                message: "Hoa hồng đã được xử lý",
                totalCredits: currentTotal.toString()
            };
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
            // Không tiếp tục cấp Credits nếu event đã tồn tại.
            // Rollback để tránh xử lý không nhất quán.
            throw new Error("AFFILIATE_COMMISSION_EVENT_DUPLICATE");
        }

        const referenceId = event.commissionId;
        const idempotencyKey = makeIdempotencyKey(event.eventHash);

        let rewardResult;

        if (difference > 0n) {
            rewardResult = await rewardService.creditWalletWithConnection(
                conn,
                {
                    userId: order.attributed_user_id,
                    amount: amount.toString(),
                    source: "affiliate",
                    idempotencyKey,
                    referenceType: "affiliate_commission",
                    referenceId,
                    description: "Credits hoa hồng Affiliate",
                    metadata: {
                        orderId: String(order.id),
                        commissionId: referenceId,
                        eventType,
                        currency: order.currency,
                        payout: String(order.payout)
                    }
                }
            );
        } else {
            if (
                typeof rewardService.reverseCreditWithConnection !== "function"
            ) {
                throw new Error("REWARD_REVERSAL_SERVICE_NOT_AVAILABLE");
            }

            rewardResult = await rewardService.reverseCreditWithConnection(
                conn,
                {
                    userId: order.attributed_user_id,
                    amount: amount.toString(),
                    idempotencyKey,
                    referenceType: "affiliate_commission",
                    referenceId,
                    description: "Thu hồi Credits hoa hồng Affiliate",
                    metadata: {
                        orderId: String(order.id),
                        commissionId: referenceId,
                        eventType,
                        currency: order.currency,
                        payout: String(order.payout ?? "0")
                    }
                }
            );
        }

        if (!rewardResult || !rewardResult.transactionId) {
            throw new Error("AFFILIATE_REWARD_TRANSACTION_FAILED");
        }

        await conn.execute(
            `UPDATE affiliate_commissions
             SET status = 'confirmed',
                 reward_transaction_id = ?,
                 processed_at = NOW()
             WHERE id = ?
               AND status = 'pending'`,
            [
                rewardResult.transactionId,
                referenceId
            ]
        );

        await conn.commit();

        return {
            success: true,
            duplicate: false,
            commissionId: referenceId,
            rewardTransactionId: rewardResult.transactionId,
            eventType,
            amount: amount.toString(),
            totalCredits: targetAmount.toString()
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
