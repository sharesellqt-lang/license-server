
"use strict";

const db = require("../db");

function positiveId(value, error = "INVALID_REFERRAL_ID") {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(error);
    return id;
}

function pagination(query = {}) {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    if (!Number.isInteger(page) || page < 1) throw new Error("INVALID_PAGE");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("INVALID_LIMIT");
    }

    return { page, limit, offset: (page - 1) * limit };
}

async function getSummary() {
    const [[referrals]] = await db.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'pending') AS pending,
            SUM(status = 'qualified') AS qualified,
            SUM(status = 'rewarded') AS rewarded,
            SUM(status = 'rejected') AS rejected
         FROM reward_referrals`
    );

    const [[codes]] = await db.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(status = 'disabled') AS disabled
         FROM reward_referral_codes`
    );

    const [[rewards]] = await db.execute(
        `SELECT
            COUNT(*) AS transaction_count,
            COALESCE(SUM(amount), 0) AS total_credits
         FROM reward_transactions
         WHERE source = 'referral'
           AND type = 'credit'`
    );

    const [[attributions]] = await db.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'waiting') AS waiting,
            SUM(status = 'eligible') AS eligible,
            SUM(status = 'rewarded') AS rewarded,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'reversed') AS reversed
         FROM reward_attributions
         WHERE source_type = 'referral'`
    );

    return { referrals, codes, rewards, attributions };
}

async function getReferrals(query = {}) {
    const { page, limit, offset } = pagination(query);
    const conditions = [];
    const params = [];

    const status = String(query.status || "").trim();
    const keyword = String(query.search || "").trim();

    if (status) {
        if (!["pending", "qualified", "rewarded", "rejected"].includes(status)) {
            throw new Error("INVALID_REFERRAL_STATUS");
        }
        conditions.push("r.status = ?");
        params.push(status);
    }

    if (keyword) {
        conditions.push(`(
            ru.email LIKE ?
            OR uu.email LIKE ?
            OR rc.referral_code LIKE ?
            OR CAST(r.id AS CHAR) = ?
            OR CAST(r.referrer_user_id AS CHAR) = ?
            OR CAST(r.referred_user_id AS CHAR) = ?
        )`);

        const like = `%${keyword}%`;
        params.push(
            like, like, like,
            keyword, keyword, keyword
        );
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM reward_referrals r
         INNER JOIN users ru ON ru.id = r.referrer_user_id
         INNER JOIN users uu ON uu.id = r.referred_user_id
         INNER JOIN reward_referral_codes rc ON rc.id = r.referral_code_id
         ${where}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            r.id,
            r.referrer_user_id,
            ru.email AS referrer_email,
            r.referred_user_id,
            uu.email AS referred_email,
            rc.referral_code,
            rc.status AS referral_code_status,
            r.status,
            r.first_purchase_payment_id,
            r.reward_transaction_id,
            r.qualified_at,
            r.rewarded_at,
            r.rejection_reason,
            r.created_at,
            a.id AS attribution_id,
            a.status AS attribution_status,
            a.reward_credits,
            a.wait_days,
            a.eligible_at,
            a.rewarded_at AS attribution_rewarded_at,
            p.amount AS payment_amount,
            p.plan AS payment_plan,
            p.status AS payment_status
         FROM reward_referrals r
         INNER JOIN users ru ON ru.id = r.referrer_user_id
         INNER JOIN users uu ON uu.id = r.referred_user_id
         INNER JOIN reward_referral_codes rc ON rc.id = r.referral_code_id
         LEFT JOIN reward_attributions a
            ON a.referral_id = r.id
         LEFT JOIN payments p
            ON p.id = r.first_purchase_payment_id
         ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    return {
        referrals: rows,
        pagination: {
            page,
            limit,
            total: Number(count.total || 0),
            totalPages: Math.ceil(Number(count.total || 0) / limit)
        }
    };
}

async function getReferralDetail(referralId) {
    const id = positiveId(referralId);

    const [rows] = await db.execute(
        `SELECT
            r.*,
            ru.email AS referrer_email,
            uu.email AS referred_email,
            rc.referral_code,
            rc.status AS referral_code_status,
            p.plan AS payment_plan,
            p.amount AS payment_amount,
            p.method AS payment_method,
            p.status AS payment_status,
            p.created_at AS payment_created_at,
            p.paid_at,
            p.approved_by_admin,
            a.id AS attribution_id,
            a.status AS attribution_status,
            a.reward_credits,
            a.wait_days,
            a.eligible_at,
            a.rewarded_at AS attribution_rewarded_at,
            a.reward_transaction_id AS attribution_transaction_id,
            a.reversal_transaction_id,
            a.reversal_reason
         FROM reward_referrals r
         INNER JOIN users ru ON ru.id = r.referrer_user_id
         INNER JOIN users uu ON uu.id = r.referred_user_id
         INNER JOIN reward_referral_codes rc ON rc.id = r.referral_code_id
         LEFT JOIN payments p ON p.id = r.first_purchase_payment_id
         LEFT JOIN reward_attributions a ON a.referral_id = r.id
         WHERE r.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) throw new Error("REFERRAL_NOT_FOUND");

    const referral = rows[0];

    const [transactions] = await db.execute(
        `SELECT
            id,
            user_id,
            type,
            source,
            amount,
            balance_before,
            balance_after,
            reference_type,
            reference_id,
            description,
            created_by_admin_id,
            created_at
         FROM reward_transactions
         WHERE id = ?
            OR id = ?
         ORDER BY created_at DESC`,
        [
            referral.reward_transaction_id || 0,
            referral.attribution_transaction_id || 0
        ]
    );

    return { referral, transactions };
}

module.exports = {
    getSummary,
    getReferrals,
    getReferralDetail
};
