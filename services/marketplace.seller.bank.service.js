
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

function positiveId(value, error = "INVALID_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }
    return id;
}

function cleanText(value, maxLength, error) {
    const text = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!text || text.length > maxLength) {
        throw new Error(error);
    }
    return text;
}

function isTrue(value) {
    return value === true || value === 1 || value === "1";
}

function normalizeBankData(data = {}) {
    return {
        bankName: cleanText(
            data.bankName,
            150,
            "INVALID_BANK_NAME"
        ),
        bankCode: cleanText(
            data.bankCode,
            50,
            "INVALID_BANK_CODE"
        ).toUpperCase(),
        accountNumber: cleanText(
            data.accountNumber,
            100,
            "INVALID_BANK_ACCOUNT_NUMBER"
        ).replace(/\s+/g, ""),
        accountHolder: cleanText(
            data.accountHolder,
            150,
            "INVALID_BANK_ACCOUNT_HOLDER"
        ).toUpperCase(),
        branch: data.branch
            ? cleanText(data.branch, 150, "INVALID_BANK_BRANCH")
            : null
    };
}

function maskAccountNumber(value) {
    const account = String(value || "");

    if (account.length <= 4) return "****";

    return `${"*".repeat(Math.min(account.length - 4, 8))}${account.slice(-4)}`;
}

function safeBankAccount(row) {
    return {
        id: row.id,
        bankName: row.bank_name,
        bankCode: row.bank_code,
        accountNumber: maskAccountNumber(row.account_number),
        accountHolder: row.account_holder,
        branch: row.branch,
        isDefault: Boolean(row.is_default),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function auditBankSnapshot(account) {
    if (!account) return null;

    return {
        id: account.id,
        bankName: account.bank_name,
        bankCode: account.bank_code,
        accountNumber: maskAccountNumber(account.account_number),
        accountHolder: account.account_holder,
        branch: account.branch,
        isDefault: Boolean(account.is_default),
        status: account.status
    };
}

function auditData(
    actorUserId,
    accountId,
    action,
    oldData,
    newData,
    audit = {}
) {
    return {
        ...audit,
        actorUserId,
        targetUserId: actorUserId,
        action,
        entityType: "marketplace_seller_bank_account",
        entityId: String(accountId),
        oldData: oldData || null,
        newData: newData || null
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

    return rows[0];
}

async function getBankAccount(
    conn,
    sellerId,
    accountId,
    lock = false
) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM marketplace_seller_bank_accounts
         WHERE id = ? AND seller_id = ?
         LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [accountId, sellerId]
    );

    if (!rows.length) {
        throw new Error("SELLER_BANK_ACCOUNT_NOT_FOUND");
    }

    return rows[0];
}

async function getMyBankAccounts(userId) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const [sellerRows] = await db.execute(
        `SELECT id
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellerRows.length) {
        throw new Error("SELLER_NOT_FOUND");
    }

    const [rows] = await db.execute(
        `SELECT *
         FROM marketplace_seller_bank_accounts
         WHERE seller_id = ?
         ORDER BY is_default DESC, created_at DESC, id DESC`,
        [sellerRows[0].id]
    );

    return rows.map(safeBankAccount);
}

async function createBankAccount(userId, data = {}, audit = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const bank = normalizeBankData(data);
    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const seller = await getSeller(conn, userId, true);

        const [existing] = await conn.execute(
            `SELECT id
             FROM marketplace_seller_bank_accounts
             WHERE seller_id = ?
               AND status = 'active'
             LIMIT 1
             FOR UPDATE`,
            [seller.id]
        );

        const makeDefault = isTrue(data.isDefault) || existing.length === 0;

        if (makeDefault) {
            await conn.execute(
                `UPDATE marketplace_seller_bank_accounts
                 SET is_default = 0
                 WHERE seller_id = ?`,
                [seller.id]
            );
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_seller_bank_accounts
             (
                seller_id,
                bank_name,
                bank_code,
                account_number,
                account_holder,
                branch,
                is_default,
                status
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                seller.id,
                bank.bankName,
                bank.bankCode,
                bank.accountNumber,
                bank.accountHolder,
                bank.branch,
                makeDefault ? 1 : 0
            ]
        );

        const accountId = result.insertId;

        await writeAudit(
            conn,
            auditData(
                userId,
                accountId,
                "marketplace.seller_bank_account.created",
                null,
                {
                    bankName: bank.bankName,
                    bankCode: bank.bankCode,
                    accountNumber: maskAccountNumber(bank.accountNumber),
                    accountHolder: bank.accountHolder,
                    branch: bank.branch,
                    isDefault: makeDefault,
                    status: "active"
                },
                audit
            )
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: accountId,
            bankName: bank.bankName,
            bankCode: bank.bankCode,
            accountNumber: maskAccountNumber(bank.accountNumber),
            accountHolder: bank.accountHolder,
            branch: bank.branch,
            isDefault: makeDefault,
            status: "active"
        };
    } catch (error) {
        if (transactionStarted) {
            await conn.rollback();
        }

        if (error.code === "ER_DUP_ENTRY") {
            throw new Error("SELLER_BANK_ACCOUNT_ALREADY_EXISTS");
        }

        throw error;
    } finally {
        conn.release();
    }
}

async function updateBankAccount(
    userId,
    accountId,
    data = {},
    audit = {}
) {
    userId = positiveId(userId, "INVALID_USER_ID");
    accountId = positiveId(accountId, "INVALID_BANK_ACCOUNT_ID");

    const bank = normalizeBankData(data);
    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const seller = await getSeller(conn, userId, true);
        const account = await getBankAccount(
            conn,
            seller.id,
            accountId,
            true
        );

        if (account.status !== "active") {
            throw new Error("SELLER_BANK_ACCOUNT_DISABLED");
        }

        const oldData = auditBankSnapshot(account);

        await conn.execute(
            `UPDATE marketplace_seller_bank_accounts
             SET bank_name = ?,
                 bank_code = ?,
                 account_number = ?,
                 account_holder = ?,
                 branch = ?
             WHERE id = ?
               AND seller_id = ?`,
            [
                bank.bankName,
                bank.bankCode,
                bank.accountNumber,
                bank.accountHolder,
                bank.branch,
                accountId,
                seller.id
            ]
        );

        await writeAudit(
            conn,
            auditData(
                userId,
                accountId,
                "marketplace.seller_bank_account.updated",
                oldData,
                {
                    id: accountId,
                    bankName: bank.bankName,
                    bankCode: bank.bankCode,
                    accountNumber: maskAccountNumber(bank.accountNumber),
                    accountHolder: bank.accountHolder,
                    branch: bank.branch,
                    isDefault: Boolean(account.is_default),
                    status: "active"
                },
                audit
            )
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: accountId,
            bankName: bank.bankName,
            bankCode: bank.bankCode,
            accountNumber: maskAccountNumber(bank.accountNumber),
            accountHolder: bank.accountHolder,
            branch: bank.branch,
            isDefault: Boolean(account.is_default),
            status: "active"
        };
    } catch (error) {
        if (transactionStarted) {
            await conn.rollback();
        }

        if (error.code === "ER_DUP_ENTRY") {
            throw new Error("SELLER_BANK_ACCOUNT_ALREADY_EXISTS");
        }

        throw error;
    } finally {
        conn.release();
    }
}

async function setDefaultBankAccount(
    userId,
    accountId,
    audit = {}
) {
    userId = positiveId(userId, "INVALID_USER_ID");
    accountId = positiveId(accountId, "INVALID_BANK_ACCOUNT_ID");

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const seller = await getSeller(conn, userId, true);
        const account = await getBankAccount(
            conn,
            seller.id,
            accountId,
            true
        );

        if (account.status !== "active") {
            throw new Error("SELLER_BANK_ACCOUNT_DISABLED");
        }

        const [oldDefaults] = await conn.execute(
            `SELECT *
             FROM marketplace_seller_bank_accounts
             WHERE seller_id = ?
               AND is_default = 1
             LIMIT 1
             FOR UPDATE`,
            [seller.id]
        );

        const oldDefault = oldDefaults[0] || null;

        if (oldDefault && Number(oldDefault.id) === accountId) {
            await conn.commit();
            transactionStarted = false;

            return {
                id: accountId,
                isDefault: true,
                unchanged: true
            };
        }

        await conn.execute(
            `UPDATE marketplace_seller_bank_accounts
             SET is_default = 0
             WHERE seller_id = ?`,
            [seller.id]
        );

        await conn.execute(
            `UPDATE marketplace_seller_bank_accounts
             SET is_default = 1
             WHERE id = ?
               AND seller_id = ?
               AND status = 'active'`,
            [accountId, seller.id]
        );

        await writeAudit(
            conn,
            auditData(
                userId,
                accountId,
                "marketplace.seller_bank_account.default_changed",
                auditBankSnapshot(oldDefault),
                auditBankSnapshot({
                    ...account,
                    is_default: 1
                }),
                audit
            )
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: accountId,
            isDefault: true
        };
    } catch (error) {
        if (transactionStarted) {
            await conn.rollback();
        }

        throw error;
    } finally {
        conn.release();
    }
}

async function disableBankAccount(
    userId,
    accountId,
    audit = {}
) {
    userId = positiveId(userId, "INVALID_USER_ID");
    accountId = positiveId(accountId, "INVALID_BANK_ACCOUNT_ID");

    const conn = await db.getConnection();
    let transactionStarted = false;

    try {
        await conn.beginTransaction();
        transactionStarted = true;

        const seller = await getSeller(conn, userId, true);
        const account = await getBankAccount(
            conn,
            seller.id,
            accountId,
            true
        );

        if (account.status === "disabled") {
            throw new Error("SELLER_BANK_ACCOUNT_ALREADY_DISABLED");
        }

        const [activePayouts] = await conn.execute(
            `SELECT id
             FROM marketplace_payout_requests
             WHERE seller_id = ?
               AND status IN (
                   'pending',
                   'under_review',
                   'approved',
                   'processing'
               )
               AND JSON_VALID(bank_snapshot) = 1
               AND JSON_UNQUOTE(
                   JSON_EXTRACT(bank_snapshot, '$.bankAccountId')
               ) = ?
             LIMIT 1
             FOR UPDATE`,
            [seller.id, String(accountId)]
        );

        if (activePayouts.length) {
            throw new Error("SELLER_BANK_ACCOUNT_IN_ACTIVE_PAYOUT");
        }

        const oldData = auditBankSnapshot(account);

        await conn.execute(
            `UPDATE marketplace_seller_bank_accounts
             SET status = 'disabled',
                 is_default = 0
             WHERE id = ?
               AND seller_id = ?`,
            [accountId, seller.id]
        );

        const [remaining] = await conn.execute(
            `SELECT id, is_default
             FROM marketplace_seller_bank_accounts
             WHERE seller_id = ?
               AND status = 'active'
             ORDER BY is_default DESC, created_at ASC, id ASC
             LIMIT 1
             FOR UPDATE`,
            [seller.id]
        );

        let newDefaultAccountId = null;

        if (remaining.length) {
            newDefaultAccountId = remaining[0].id;

            if (!remaining[0].is_default) {
                await conn.execute(
                    `UPDATE marketplace_seller_bank_accounts
                     SET is_default = 1
                     WHERE id = ?
                       AND seller_id = ?
                       AND status = 'active'`,
                    [newDefaultAccountId, seller.id]
                );
            }
        }

        await writeAudit(
            conn,
            auditData(
                userId,
                accountId,
                "marketplace.seller_bank_account.disabled",
                oldData,
                {
                    ...oldData,
                    isDefault: false,
                    status: "disabled",
                    replacementDefaultAccountId: account.is_default
                        ? newDefaultAccountId
                        : null
                },
                audit
            )
        );

        await conn.commit();
        transactionStarted = false;

        return {
            id: accountId,
            status: "disabled",
            newDefaultAccountId: account.is_default
                ? newDefaultAccountId
                : null
        };
    } catch (error) {
        if (transactionStarted) {
            await conn.rollback();
        }

        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getMyBankAccounts,
    createBankAccount,
    updateBankAccount,
    setDefaultBankAccount,
    disableBankAccount
};
