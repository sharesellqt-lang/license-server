
"use strict";

const { writeAudit } = require("./contributor.audit.service");

const db = require("../db");

const MAX_CREDITS = BigInt("18446744073709551615");

function parseCredits(value) {
    let amount;

    try {
        amount = BigInt(value);
    } catch {
        throw new Error("INVALID_AMOUNT");
    }

    if (amount <= 0n || amount > MAX_CREDITS) {
        throw new Error("INVALID_AMOUNT");
    }

    return amount;
}

function outputNumber(value) {
    const n = BigInt(value);

    return n <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(n)
        : n.toString();
}

function validateInput(data) {
    const userId = Number(data.userId);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    if (!["credit", "debit"].includes(data.type)) {
        throw new Error("INVALID_TRANSACTION_TYPE");
    }

    if (
        typeof data.source !== "string" ||
        !data.source.trim() ||
        data.source.length > 40
    ) {
        throw new Error("INVALID_SOURCE");
    }

    if (
        typeof data.idempotencyKey !== "string" ||
        !data.idempotencyKey.trim() ||
        data.idempotencyKey.length > 120
    ) {
        throw new Error("INVALID_IDEMPOTENCY_KEY");
    }

    if (
        data.description != null &&
        String(data.description).length > 255
    ) {
        throw new Error("DESCRIPTION_TOO_LONG");
    }

    if (
        data.referenceType != null &&
        String(data.referenceType).length > 50
    ) {
        throw new Error("INVALID_REFERENCE_TYPE");
    }

    if (
        data.referenceId != null &&
        String(data.referenceId).length > 100
    ) {
        throw new Error("INVALID_REFERENCE_ID");
    }

    if (
        data.createdByAdminId != null &&
        (!Number.isSafeInteger(Number(data.createdByAdminId)) ||
         Number(data.createdByAdminId) <= 0)
    ) {
        throw new Error("INVALID_ADMIN_ID");
    }

    if (
        data.actorUserId != null &&
        (!Number.isSafeInteger(Number(data.actorUserId)) ||
         Number(data.actorUserId) <= 0)
    ) {
        throw new Error("INVALID_ACTOR_ID");
    }

    return {
        ...data,
        userId,
        actorUserId: data.actorUserId == null
            ? null
            : Number(data.actorUserId),
        amount: parseCredits(data.amount),
        source: data.source.trim()
    };
}

/**
 * Thực hiện giao dịch trên connection được truyền vào.
 * Không tự beginTransaction, commit, rollback hoặc release.
 */
async function applyTransactionWithConnection(conn, input) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_DATABASE_CONNECTION");
    }

    const data = validateInput(input);

    // Tạo ví nếu chưa tồn tại.
    await conn.execute(
        `INSERT IGNORE INTO reward_wallets (user_id)
         VALUES (?)`,
        [data.userId]
    );

    // Khóa ví.
    const [walletRows] = await conn.execute(
        `SELECT id, user_id, balance, lifetime_earned,
                lifetime_spent, status
         FROM reward_wallets
         WHERE user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [data.userId]
    );

    if (!walletRows.length) {
        throw new Error("WALLET_NOT_FOUND");
    }

    const wallet = walletRows[0];

    if (wallet.status !== "active") {
        throw new Error("WALLET_LOCKED");
    }

    // Kiểm tra idempotency.
    const [existingRows] = await conn.execute(
        `SELECT id, user_id, type, source, amount,
                balance_before, balance_after,
                idempotency_key, created_at
         FROM reward_transactions
         WHERE idempotency_key = ?
         LIMIT 1`,
        [data.idempotencyKey]
    );

    if (existingRows.length) {
        const existing = existingRows[0];

        if (Number(existing.user_id) !== data.userId) {
            throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        }

        if (
            existing.type !== data.type ||
            existing.source !== data.source ||
            BigInt(existing.amount) !== data.amount
        ) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
        }

        return {
            success: true,
            duplicate: true,
            transaction: existing,
            transactionId: existing.id,
            balance: outputNumber(wallet.balance)
        };
    }

    const balanceBefore = BigInt(wallet.balance);
    let balanceAfter;

    if (data.type === "credit") {
        balanceAfter = balanceBefore + data.amount;

        if (balanceAfter > MAX_CREDITS) {
            throw new Error("BALANCE_OVERFLOW");
        }
    } else {
        if (balanceBefore < data.amount) {
            throw new Error("INSUFFICIENT_CREDITS");
        }

        balanceAfter = balanceBefore - data.amount;
    }

    // Cập nhật ví.
    if (data.type === "credit") {
        await conn.execute(
            `UPDATE reward_wallets
             SET balance = ?,
                 lifetime_earned = lifetime_earned + ?
             WHERE id = ?`,
            [
                balanceAfter.toString(),
                data.amount.toString(),
                wallet.id
            ]
        );
    } else {
        await conn.execute(
            `UPDATE reward_wallets
             SET balance = ?,
                 lifetime_spent = lifetime_spent + ?
             WHERE id = ?`,
            [
                balanceAfter.toString(),
                data.amount.toString(),
                wallet.id
            ]
        );
    }

    // Ghi Ledger.
    const [result] = await conn.execute(
        `INSERT INTO reward_transactions (
            wallet_id,
            user_id,
            type,
            source,
            amount,
            balance_before,
            balance_after,
            reference_type,
            reference_id,
            idempotency_key,
            description,
            metadata,
            created_by_admin_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            wallet.id,
            data.userId,
            data.type,
            data.source,
            data.amount.toString(),
            balanceBefore.toString(),
            balanceAfter.toString(),
            data.referenceType || null,
            data.referenceId || null,
            data.idempotencyKey,
            data.description || null,
            data.metadata == null
                ? null
                : JSON.stringify(data.metadata),
            data.createdByAdminId || null
        ]
    );

await writeAudit(conn, {
    actorUserId: data.actorUserId,
    targetUserId: data.userId,
    action: data.type === "credit"
        ? "credits.credited"
        : "credits.debited",
    entityType: "reward_transaction",
    entityId: result.insertId,
    oldData: {
        balance: outputNumber(balanceBefore)
    },
    newData: {
        balance: outputNumber(balanceAfter),
        type: data.type,
        amount: outputNumber(data.amount),
        source: data.source,
        referenceType: data.referenceType || null,
        referenceId: data.referenceId || null
    }
});
    return {
        success: true,
        duplicate: false,
        transactionId: result.insertId,
        type: data.type,
        amount: outputNumber(data.amount),
        balanceBefore: outputNumber(balanceBefore),
        balanceAfter: outputNumber(balanceAfter)
    };
}

/**
 * API cũ: tự quản lý connection và transaction.
 */
async function applyTransaction(input) {
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const result = await applyTransactionWithConnection(conn, input);

        await conn.commit();

        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function creditWallet(data) {
    return applyTransaction({
        ...data,
        type: "credit"
    });
}

async function debitWallet(data) {
    return applyTransaction({
        ...data,
        type: "debit"
    });
}

/**
 * API mới: cộng Credits trong transaction bên ngoài.
 * Caller chịu trách nhiệm commit/rollback.
 */
async function creditWalletWithConnection(conn, data) {
    return applyTransactionWithConnection(conn, {
        ...data,
        type: "credit"
    });
}

module.exports = {
    creditWallet,
    debitWallet,
    creditWalletWithConnection
};
