
"use strict";

const db = require("../db");

async function getOrCreateWallet(userId) {
    if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    await db.execute(
        `INSERT IGNORE INTO reward_wallets (user_id)
         VALUES (?)`,
        [userId]
    );

    const [rows] = await db.execute(
        `SELECT id, user_id, balance, lifetime_earned,
                lifetime_spent, status, created_at, updated_at
         FROM reward_wallets
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!rows.length) {
        throw new Error("WALLET_NOT_FOUND");
    }

    return rows[0];
}

async function getTransactions(userId, page = 1, limit = 20) {
    const wallet = await getOrCreateWallet(userId);

    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const offset = (page - 1) * limit;

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM reward_transactions
         WHERE wallet_id = ?`,
        [wallet.id]
    );

    const [rows] = await db.execute(
        `SELECT id, type, source, amount,
                balance_before, balance_after,
                reference_type, reference_id,
                description, created_at
         FROM reward_transactions
         WHERE wallet_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [wallet.id, limit, offset]
    );

    return {
        transactions: rows,
        pagination: {
            page,
            limit,
            total: Number(count.total),
            totalPages: Math.ceil(Number(count.total) / limit)
        }
    };
}

module.exports = {
    getOrCreateWallet,
    getTransactions
};
