
"use strict";

const crypto = require("crypto");
const db = require("../db");

const REFERRAL_BASE_URL = "https://sharesell.net/tools/index.html";

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

    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const ownReferralCode = await ensureReferralCode(
            conn,
            normalizedUserId
        );

        let referralRecorded = false;
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

        // Đảm bảo tài khoản luôn có mã Referral riêng.
        await ensureReferralCode(conn, normalizedUserId);

        const [codes] = await conn.execute(
            `SELECT referral_code, status
             FROM reward_referral_codes
             WHERE user_id = ?
             LIMIT 1`,
            [normalizedUserId]
        );

        const [summaryRows] = await conn.execute(
            `SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status = 'pending'), 0) AS pending,
                COALESCE(SUM(status = 'qualified'), 0) AS qualified,
                COALESCE(SUM(status = 'rewarded'), 0) AS rewarded,
                COALESCE(SUM(status = 'rejected'), 0) AS rejected
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
                rr.referred_user_id AS userId,
                u.email AS email,
                rr.status AS status,
                rr.created_at AS createdAt,
                rr.qualified_at AS qualifiedAt,
                rr.rewarded_at AS rewardedAt,
                rr.rejection_reason AS rejectionReason,
                COALESCE(rt.amount, 0) AS creditsEarned,
                p.plan AS purchasedPlan,
                p.amount AS paymentAmount,
                p.status AS paymentStatus
             FROM reward_referrals rr
             LEFT JOIN users u
                ON u.id = rr.referred_user_id
             LEFT JOIN reward_transactions rt
                ON rt.id = rr.reward_transaction_id
               AND rt.type = 'credit'
             LEFT JOIN payments p
                ON p.id = rr.first_purchase_payment_id
             WHERE rr.referrer_user_id = ?
             ORDER BY rr.created_at DESC, rr.id DESC
             LIMIT 100`,
            [normalizedUserId]
        );

        await conn.commit();

        const code = codes[0] || null;
        const codeStatus = code?.status || null;
        const referralCode = code?.referral_code || null;

        return {
            referralCode,
            referralCodeStatus: codeStatus,
            referralLink: codeStatus === "active" && referralCode
                ? `${REFERRAL_BASE_URL}?ref=${encodeURIComponent(referralCode)}`
                : null,
            stats: {
                total: Number(summaryRows[0]?.total || 0),
                pending: Number(summaryRows[0]?.pending || 0),
                qualified: Number(summaryRows[0]?.qualified || 0),
                rewarded: Number(summaryRows[0]?.rewarded || 0),
                rejected: Number(summaryRows[0]?.rejected || 0),
                totalCredits: Number(walletRows[0]?.total_credits || 0),
                totalTransactions: Number(walletRows[0]?.total_transactions || 0)
            },
            referrals: referrals.map(item => ({
                id: Number(item.id),
                userId: Number(item.userId),
                email: item.email || null,
                status: item.status,
                createdAt: item.createdAt,
                qualifiedAt: item.qualifiedAt,
                rewardedAt: item.rewardedAt,
                rejectionReason: item.rejectionReason || null,
                creditsEarned: Number(item.creditsEarned || 0),
                purchasedPlan: item.purchasedPlan || null,
                paymentAmount: Number(item.paymentAmount || 0),
                paymentStatus: item.paymentStatus || null
            }))
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
