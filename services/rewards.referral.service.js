
"use strict";

const crypto = require("crypto");
const db = require("../db");

function generateReferralCode() {
    return crypto.randomBytes(5).toString("hex").toUpperCase();
}

async function ensureReferralCode(conn, userId) {
    const [existing] = await conn.execute(
        `SELECT referral_code
         FROM reward_referral_codes
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (existing.length) return existing[0].referral_code;

    for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateReferralCode();

        try {
            await conn.execute(
                `INSERT INTO reward_referral_codes
                    (user_id, referral_code, status)
                 VALUES (?, ?, 'active')`,
                [userId, code]
            );

            return code;
        } catch (error) {
            if (error.code !== "ER_DUP_ENTRY") throw error;

            // Có thể tài khoản đã được tạo mã ở một request đồng thời.
            const [rows] = await conn.execute(
                `SELECT referral_code
                 FROM reward_referral_codes
                 WHERE user_id = ?
                 LIMIT 1`,
                [userId]
            );

            if (rows.length) return rows[0].referral_code;
        }
    }

    throw new Error("REFERRAL_CODE_GENERATION_FAILED");
}

async function processGoogleLogin({ userId, isNewUser, referralCode }) {
    const normalizedUserId = Number(userId);

    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // Mỗi tài khoản đều có mã giới thiệu riêng.
        const ownReferralCode = await ensureReferralCode(
            conn,
            normalizedUserId
        );

        let referralRecorded = false;

        // Chỉ tài khoản vừa đăng ký mới được ghi nhận người giới thiệu.
        const incomingCode = String(referralCode || "").trim();

        if (
            isNewUser &&
            incomingCode &&
            /^[a-zA-Z0-9_-]{3,40}$/.test(incomingCode)
        ) {
            const [referrers] = await conn.execute(
                `SELECT id, user_id
                 FROM reward_referral_codes
                 WHERE referral_code = ?
                   AND status = 'active'
                 LIMIT 1
                 FOR UPDATE`,
                [incomingCode]
            );

            if (
                referrers.length &&
                Number(referrers[0].user_id) !== normalizedUserId
            ) {
                const [result] = await conn.execute(
                    `INSERT IGNORE INTO reward_referrals
                        (referrer_user_id, referred_user_id,
                         referral_code_id, status)
                     VALUES (?, ?, ?, 'pending')`,
                    [
                        referrers[0].user_id,
                        normalizedUserId,
                        referrers[0].id
                    ]
                );

                referralRecorded = result.affectedRows > 0;
            }
        }

        await conn.commit();

        return {
            success: true,
            ownReferralCode,
            referralRecorded
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function getMyReferral(userId) {
    const normalizedUserId = Number(userId);

    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const referralCode = await ensureReferralCode(
            conn,
            normalizedUserId
        );

        const [codes] = await conn.execute(
            `SELECT id, referral_code, status
             FROM reward_referral_codes
             WHERE user_id = ?
             LIMIT 1`,
            [normalizedUserId]
        );

        const [summaryRows] = await conn.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(status = 'pending') AS pending,
                SUM(status = 'qualified') AS qualified,
                SUM(status = 'rewarded') AS rewarded,
                SUM(status = 'rejected') AS rejected
             FROM reward_referrals
             WHERE referrer_user_id = ?`,
            [normalizedUserId]
        );

        const [walletRows] = await conn.execute(
            `SELECT
                COALESCE(SUM(amount), 0) AS total_credits,
                COUNT(*) AS total_transactions
             FROM reward_transactions
             WHERE user_id = ?
               AND source = 'referral'
               AND type = 'credit'`,
            [normalizedUserId]
        );

        const [referrals] = await conn.execute(
            `SELECT
                rr.id,
                rr.status,
                rr.created_at,
                rr.qualified_at,
                rr.rewarded_at,
                rr.rejection_reason,
                u.email AS referred_email,
                rt.amount AS reward_credits,
                p.plan AS purchased_plan,
                p.amount AS payment_amount,
                p.status AS payment_status
             FROM reward_referrals rr
             LEFT JOIN users u
                ON u.id = rr.referred_user_id
             LEFT JOIN reward_transactions rt
                ON rt.id = rr.reward_transaction_id
             LEFT JOIN payments p
                ON p.id = rr.first_purchase_payment_id
             WHERE rr.referrer_user_id = ?
             ORDER BY rr.created_at DESC
             LIMIT 100`,
            [normalizedUserId]
        );

        await conn.commit();

        const code = codes[0] || {
            referral_code: referralCode,
            status: "active"
        };

        return {
            referralCode: code.referral_code,
            codeStatus: code.status,
            referralLink: code.status === "active"
                ? `https://sharesell.net/?ref=${encodeURIComponent(code.referral_code)}`
                : null,
            summary: {
                total: Number(summaryRows[0]?.total || 0),
                pending: Number(summaryRows[0]?.pending || 0),
                qualified: Number(summaryRows[0]?.qualified || 0),
                rewarded: Number(summaryRows[0]?.rewarded || 0),
                rejected: Number(summaryRows[0]?.rejected || 0),
                totalCredits: Number(walletRows[0]?.total_credits || 0),
                totalTransactions: Number(walletRows[0]?.total_transactions || 0)
            },
            referrals
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}
module.exports = {
    processGoogleLogin,
    getMyReferral
};
