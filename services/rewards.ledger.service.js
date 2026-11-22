
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
 * Ưu tiên dùng Credits vừa được cộng để thu hồi
 * các khoản Affiliate còn thiếu.
 *
 * Yêu cầu: wallet đã được khóa FOR UPDATE trước khi gọi.
 * Không tự quản lý transaction.
 */
async function processPendingRecoveriesWithConnection(
    conn,
    data,
    wallet
) {
    let availableCredit = data.amount;
    let currentBalance = BigInt(wallet.balance);
    const recoveries = [];

    if (availableCredit <= 0n) {
        return {
            recoveredAmount: 0n,
            remainingCredit: availableCredit,
            currentBalance,
            recoveries
        };
    }

    // Thứ tự khóa thống nhất: wallet trước, recovery sau.
    const [rows] = await conn.execute(
        `SELECT
            id,
            commission_id,
            amount,
            recovered_amount
         FROM affiliate_credit_recoveries
         WHERE user_id = ?
           AND status IN ('pending', 'partial')
           AND recovered_amount < amount
         ORDER BY id ASC
         FOR UPDATE`,
        [data.userId]
    );

    for (const recovery of rows) {
        if (availableCredit <= 0n) break;

        const debtAmount = BigInt(recovery.amount);
        const recoveredBefore = BigInt(recovery.recovered_amount);
        const debtRemaining = debtAmount - recoveredBefore;

        if (debtRemaining <= 0n) continue;

        const deduction = debtRemaining < availableCredit
            ? debtRemaining
            : availableCredit;

        const recoveredAfter = recoveredBefore + deduction;
        const balanceBefore = currentBalance;
        const balanceAfter = balanceBefore - deduction;

        if (balanceAfter < 0n) {
            throw new Error("INSUFFICIENT_CREDITS_FOR_RECOVERY");
        }

        const recoveryId = String(recovery.id);
        const commissionId = String(recovery.commission_id);

        // Idempotency gắn với số tiền đã thu hồi lũy kế.
        const idempotencyKey =
            `affiliate:recovery:${recoveryId}:${recoveredAfter}`;

        // Trừ số dư ví.
        await conn.execute(
            `UPDATE reward_wallets
             SET balance = ?
             WHERE id = ?`,
            [
                balanceAfter.toString(),
                wallet.id
            ]
        );

        // Ghi giao dịch reversal riêng.
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
            ) VALUES (
                ?, ?, 'reversal', 'affiliate',
                ?, ?, ?, ?, ?, ?, ?, ?, NULL
            )`,
            [
                wallet.id,
                data.userId,
                deduction.toString(),
                balanceBefore.toString(),
                balanceAfter.toString(),
                "affiliate_credit_recovery",
                recoveryId,
                idempotencyKey,
                "Thu hồi Credits Affiliate còn thiếu",
                JSON.stringify({
                    recoveryId,
                    commissionId,
                    originalCreditId: data.referenceId || null,
                    originalCreditSource: data.source,
                    recoveredBefore: recoveredBefore.toString(),
                    recoveredAfter: recoveredAfter.toString()
                })
            ]
        );

        // Cập nhật tiến độ thu hồi.
        const status = recoveredAfter >= debtAmount
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

        await writeAudit(conn, {
            actorUserId: data.actorUserId || null,
            targetUserId: data.userId,
            action: "credits.affiliate_recovery",
            entityType: "reward_transaction",
            entityId: result.insertId,
            oldData: {
                balance: outputNumber(balanceBefore),
                recoveredAmount: outputNumber(recoveredBefore),
                recoveryStatus: recoveredBefore > 0n
                    ? "partial"
                    : "pending"
            },
            newData: {
                balance: outputNumber(balanceAfter),
                amount: outputNumber(deduction),
                recoveredAmount: outputNumber(recoveredAfter),
                recoveryStatus: status,
                recoveryId,
                commissionId
            }
        });

        currentBalance = balanceAfter;
        availableCredit -= deduction;

        recoveries.push({
            recoveryId,
            commissionId,
            amount: deduction.toString(),
            recoveredAmount: recoveredAfter.toString(),
            remainingAmount: (debtAmount - recoveredAfter).toString(),
            status,
            transactionId: result.insertId
        });
    }

    return {
        recoveredAmount: data.amount - availableCredit,
        remainingCredit: availableCredit,
        currentBalance,
        recoveries
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

    // Khóa ví trước khi xử lý bất kỳ khoản thu hồi nào.
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

    // Kiểm tra idempotency trước khi xử lý thu hồi.
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
            balanceBefore: outputNumber(existing.balance_before),
            balanceAfter: outputNumber(existing.balance_after),
            currentBalance: outputNumber(wallet.balance),
            recovery: null
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

    // Cập nhật ví và thống kê tích lũy.
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

    // Ghi giao dịch cộng/trừ Credits ban đầu.
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

    // Chỉ giao dịch credit mới kích hoạt thu hồi tự động.
    let recovery = null;
    let currentBalance = balanceAfter;

    if (data.type === "credit") {
        recovery = await processPendingRecoveriesWithConnection(
            conn,
            data,
            {
                ...wallet,
                balance: balanceAfter.toString()
            }
        );

        currentBalance = recovery.currentBalance;
    }

    return {
        success: true,
        duplicate: false,
        transactionId: result.insertId,
        type: data.type,
        amount: outputNumber(data.amount),
        balanceBefore: outputNumber(balanceBefore),
        balanceAfter: outputNumber(currentBalance),
        currentBalance: outputNumber(currentBalance),
        recovery: recovery
            ? {
                recoveredAmount: recovery.recoveredAmount.toString(),
                remainingCredit: recovery.remainingCredit.toString(),
                recoveries: recovery.recoveries
            }
            : null
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


async function reverseCreditWithConnection(conn, data) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_DATABASE_CONNECTION");
    }

    const userId = Number(data.userId);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const amount = parseCredits(data.amount);

    if (
        typeof data.idempotencyKey !== "string" ||
        !data.idempotencyKey.trim() ||
        data.idempotencyKey.length > 120
    ) {
        throw new Error("INVALID_IDEMPOTENCY_KEY");
    }

    await conn.execute(
        `INSERT IGNORE INTO reward_wallets (user_id)
         VALUES (?)`,
        [userId]
    );

    const [walletRows] = await conn.execute(
        `SELECT id, user_id, balance, lifetime_earned,
                lifetime_spent, status
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

    const [existingRows] = await conn.execute(
        `SELECT id, user_id, type, source, amount,
                balance_before, balance_after
         FROM reward_transactions
         WHERE idempotency_key = ?
         LIMIT 1`,
        [data.idempotencyKey]
    );

    if (existingRows.length) {
        const existing = existingRows[0];

        if (
            Number(existing.user_id) !== userId ||
            existing.type !== "reversal" ||
            existing.source !== "affiliate" ||
            BigInt(existing.amount) !== amount
        ) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
        }

        return {
            success: true,
            duplicate: true,
            transactionId: existing.id,
            balanceBefore: outputNumber(existing.balance_before),
            balanceAfter: outputNumber(existing.balance_after),
            currentBalance: outputNumber(wallet.balance)
        };
    }

    const balanceBefore = BigInt(wallet.balance);

    if (balanceBefore < amount) {
        throw new Error("INSUFFICIENT_CREDITS_FOR_REVERSAL");
    }

    const balanceAfter = balanceBefore - amount;

    await conn.execute(
        `UPDATE reward_wallets
        SET balance = ?
        WHERE id = ?`,
        [
            balanceAfter.toString(),
            wallet.id
        ]
    );

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
        ) VALUES (?, ?, 'reversal', 'affiliate', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
            wallet.id,
            userId,
            amount.toString(),
            balanceBefore.toString(),
            balanceAfter.toString(),
            data.referenceType || "affiliate_commission",
            data.referenceId || null,
            data.idempotencyKey,
            data.description || "Đảo Credits hoa hồng Affiliate",
            data.metadata == null
                ? null
                : JSON.stringify(data.metadata)
        ]
    );

    await writeAudit(conn, {
        actorUserId: data.actorUserId || null,
        targetUserId: userId,
        action: "credits.reversed",
        entityType: "reward_transaction",
        entityId: result.insertId,
        oldData: {
            balance: outputNumber(balanceBefore)
        },
        newData: {
            balance: outputNumber(balanceAfter),
            type: "reversal",
            amount: outputNumber(amount),
            source: "affiliate",
            referenceType: data.referenceType || "affiliate_commission",
            referenceId: data.referenceId || null
        }
    });

    return {
        success: true,
        duplicate: false,
        transactionId: result.insertId,
        type: "reversal",
        amount: outputNumber(amount),
        balanceBefore: outputNumber(balanceBefore),
        balanceAfter: outputNumber(balanceAfter)
    };
}


module.exports = {
    creditWallet,
    debitWallet,
    creditWalletWithConnection,
    reverseCreditWithConnection
};