
"use strict";

const rewardService = require("./rewards.ledger.service");

function positiveId(value, error = "INVALID_AFFILIATE_RECOVERY_ID") {
    const id = String(value ?? "").trim();

    if (!/^[1-9]\d*$/.test(id)) {
        throw new Error(error);
    }

    return id;
}

function positiveAmount(value) {
    let amount;

    try {
        amount = BigInt(value);
    } catch {
        throw new Error("INVALID_AFFILIATE_RECOVERY_AMOUNT");
    }

    if (amount <= 0n) {
        throw new Error("INVALID_AFFILIATE_RECOVERY_AMOUNT");
    }

    return amount;
}

/**
 * Tạo hoặc cập nhật nghĩa vụ thu hồi.
 * Phải được gọi bên trong transaction của caller.
 */
async function createRecoveryWithConnection(conn, data = {}) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_DATABASE_CONNECTION");
    }

    const userId = positiveId(data.userId, "INVALID_USER_ID");
    const orderId = positiveId(data.orderId, "INVALID_AFFILIATE_ORDER_ID");
    const commissionId = positiveId(
        data.commissionId,
        "INVALID_AFFILIATE_COMMISSION_ID"
    );
    const amount = positiveAmount(data.amount);

    const [existingRows] = await conn.execute(
        `SELECT *
         FROM affiliate_credit_recoveries
         WHERE commission_id = ?
         LIMIT 1
         FOR UPDATE`,
        [commissionId]
    );

    if (existingRows.length) {
        const existing = existingRows[0];

        if (
            String(existing.user_id) !== userId ||
            String(existing.order_id) !== orderId
        ) {
            throw new Error("AFFILIATE_RECOVERY_DATA_CONFLICT");
        }

        const recovered = BigInt(existing.recovered_amount);

        if (amount < recovered) {
            throw new Error("AFFILIATE_RECOVERY_AMOUNT_BELOW_RECOVERED");
        }

        await conn.execute(
            `UPDATE affiliate_credit_recoveries
             SET amount = ?,
                 status = CASE
                     WHEN recovered_amount >= ? THEN 'recovered'
                     WHEN recovered_amount > 0 THEN 'partial'
                     ELSE 'pending'
                 END
             WHERE id = ?`,
            [
                amount.toString(),
                amount.toString(),
                existing.id
            ]
        );

        return {
            success: true,
            duplicate: true,
            recoveryId: String(existing.id),
            amount: amount.toString(),
            recoveredAmount: recovered.toString(),
            remainingAmount: (amount - recovered).toString()
        };
    }

    const [result] = await conn.execute(
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
            orderId,
            commissionId,
            amount.toString()
        ]
    );

    return {
        success: true,
        duplicate: false,
        recoveryId: String(result.insertId),
        amount: amount.toString(),
        recoveredAmount: "0",
        remainingAmount: amount.toString()
    };
}

/**
 * Thu hồi phần Credits còn thiếu.
 * Caller phải quản lý transaction.
 */
async function collectRecoveryWithConnection(conn, recoveryId) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_DATABASE_CONNECTION");
    }

    recoveryId = positiveId(recoveryId);

    const [rows] = await conn.execute(
        `SELECT *
         FROM affiliate_credit_recoveries
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [recoveryId]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_RECOVERY_NOT_FOUND");
    }

    const recovery = rows[0];
    const amount = BigInt(recovery.amount);
    const recovered = BigInt(recovery.recovered_amount);
    const remaining = amount - recovered;

    if (remaining <= 0n) {
        return {
            success: true,
            duplicate: true,
            recoveryId,
            recoveredAmount: recovered.toString(),
            remainingAmount: "0",
            status: "recovered"
        };
    }

    const [walletRows] = await conn.execute(
        `SELECT id, balance, status
         FROM reward_wallets
         WHERE user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [recovery.user_id]
    );

    if (!walletRows.length) {
        return {
            success: true,
            recoveryId,
            recoveredAmount: recovered.toString(),
            remainingAmount: remaining.toString(),
            status: "pending"
        };
    }

    const wallet = walletRows[0];

    if (wallet.status !== "active") {
        throw new Error("WALLET_LOCKED");
    }

    const balance = BigInt(wallet.balance);
    const collectAmount = balance < remaining ? balance : remaining;

    if (collectAmount <= 0n) {
        return {
            success: true,
            recoveryId,
            recoveredAmount: recovered.toString(),
            remainingAmount: remaining.toString(),
            status: "pending"
        };
    }

    const nextRecovered = recovered + collectAmount;
    const nextStatus = nextRecovered >= amount
        ? "recovered"
        : "partial";

    const idempotencyKey =
        `affiliate:recovery:${recoveryId}:${nextRecovered}`;

    const rewardResult = await rewardService.reverseCreditWithConnection(
        conn,
        {
            userId: recovery.user_id,
            amount: collectAmount.toString(),
            idempotencyKey,
            referenceType: "affiliate_credit_recovery",
            referenceId: recoveryId,
            description: "Thu hồi Credits hoa hồng Affiliate",
            metadata: {
                recoveryId,
                orderId: String(recovery.order_id),
                commissionId: String(recovery.commission_id)
            }
        }
    );

    if (!rewardResult || !rewardResult.transactionId) {
        throw new Error("AFFILIATE_RECOVERY_TRANSACTION_FAILED");
    }

    await conn.execute(
        `UPDATE affiliate_credit_recoveries
         SET recovered_amount = ?,
             status = ?
         WHERE id = ?`,
        [
            nextRecovered.toString(),
            nextStatus,
            recoveryId
        ]
    );

    return {
        success: true,
        duplicate: false,
        recoveryId,
        transactionId: rewardResult.transactionId,
        recoveredAmount: nextRecovered.toString(),
        remainingAmount: (amount - nextRecovered).toString(),
        status: nextStatus
    };
}

module.exports = {
    createRecoveryWithConnection,
    collectRecoveryWithConnection
};
