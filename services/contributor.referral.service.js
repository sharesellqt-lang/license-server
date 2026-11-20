"use strict";

const db = require("../db");

async function getMyReferral(userId) {
    const normalizedUserId = Number(userId);

    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const [codes] = await db.execute(
        `SELECT id, referral_code, status, created_at
         FROM reward_referral_codes
         WHERE user_id = ?
         LIMIT 1`,
        [normalizedUserId]
    );

    const [statsRows] = await db.execute(
        `SELECT
            COUNT(rr.id) AS total_referrals,
            SUM(rr.status = 'pending') AS pending,
            SUM(rr.status = 'qualified') AS qualified,
            SUM(rr.status = 'rewarded') AS rewarded,
            SUM(rr.status = 'rejected') AS rejected,
            COALESCE(SUM(
                CASE
                    WHEN rr.status = 'rewarded' THEN COALESCE(rt.amount, 0)
                    ELSE 0
                END
            ), 0) AS total_credits
         FROM reward_referrals rr
         LEFT JOIN reward_transactions rt
            ON rt.id = rr.reward_transaction_id
           AND rt.type = 'credit'
         WHERE rr.referrer_user_id = ?`,
        [normalizedUserId]
    );

    const [referrals] = await db.execute(
        `SELECT
            rr.id,
            rr.referred_user_id,
            u.email AS referred_email,
            rr.status,
            rr.created_at,
            rr.qualified_at,
            rr.rewarded_at,
            COALESCE(rt.amount, 0) AS credits_earned
         FROM reward_referrals rr
         LEFT JOIN users u
            ON u.id = rr.referred_user_id
         LEFT JOIN reward_transactions rt
            ON rt.id = rr.reward_transaction_id
           AND rt.type = 'credit'
         WHERE rr.referrer_user_id = ?
         ORDER BY rr.created_at DESC, rr.id DESC`,
        [normalizedUserId]
    );

    const stats = statsRows[0] || {};

    return {
        referralCode: codes[0]?.referral_code || null,
        referralCodeStatus: codes[0]?.status || null,
        referralLink: codes[0]?.referral_code
            ? `https://sharesell.net/?ref=${encodeURIComponent(codes[0].referral_code)}`
            : null,
        stats: {
            total: Number(stats.total_referrals || 0),
            pending: Number(stats.pending || 0),
            qualified: Number(stats.qualified || 0),
            rewarded: Number(stats.rewarded || 0),
            rejected: Number(stats.rejected || 0),
            totalCredits: Number(stats.total_credits || 0)
        },
        referrals: referrals.map(item => ({
            id: Number(item.id),
            userId: Number(item.referred_user_id),
            email: item.referred_email || null,
            status: item.status,
            createdAt: item.created_at,
            qualifiedAt: item.qualified_at,
            rewardedAt: item.rewarded_at,
            creditsEarned: Number(item.credits_earned || 0)
        }))
    };
}

module.exports = { getMyReferral };