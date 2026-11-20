
"use strict";

const db = require("../db");
const rewardsLedger = require("./rewards.ledger.service");

async function processDueAttributions({ limit = 50 } = {}) {
    const maxItems = Math.max(1, Math.min(Number(limit) || 50, 500));

    const attemptedIds = new Set();

    const summary = {
        attempted: 0,
        rewarded: 0,
        failed: 0,
        errors: []
    };

    while (attemptedIds.size < maxItems) {
        const conn = await db.getConnection();
        let currentAttributionId = null;

        try {
            await conn.beginTransaction();

            // 1. Find next due referral attribution
            const excludedIds = [...attemptedIds];

            const excludeSql = excludedIds.length
                ? `AND a.id NOT IN (${excludedIds.map(() => "?").join(",")})`
                : "";

            const [rows] = await conn.execute(
                `SELECT
                    a.id,
                    a.payment_id,
                    a.referral_id,
                    a.referrer_user_id,
                    a.referred_user_id,
                    a.reward_credits,
                    a.wait_days
                 FROM reward_attributions a
                 INNER JOIN payments p ON p.id = a.payment_id
                 WHERE a.source_type = 'referral'
                   AND a.status IN ('waiting', 'eligible')
                   AND a.eligible_at IS NOT NULL
                   AND a.eligible_at <= NOW()
                   AND a.reward_credits > 0
                   AND p.status = 'paid'
                   AND p.approved_by_admin = 1
                   ${excludeSql}
                 ORDER BY a.eligible_at ASC, a.id ASC
                 LIMIT 1
                 FOR UPDATE`,
                excludedIds
            );

            if (!rows.length) {
                await conn.commit();
                break;
            }

            const attribution = rows[0];
            currentAttributionId = String(attribution.id);
            attemptedIds.add(currentAttributionId);

            // 2. Lock referral relation
            const [referrals] = await conn.execute(
                `SELECT id, status, reward_transaction_id
                 FROM reward_referrals
                 WHERE id = ?
                   AND referred_user_id = ?
                   AND referrer_user_id = ?
                 FOR UPDATE`,
                [
                    attribution.referral_id,
                    attribution.referred_user_id,
                    attribution.referrer_user_id
                ]
            );

            if (
                !referrals.length ||
                referrals[0].status !== "qualified" ||
                referrals[0].reward_transaction_id !== null
            ) {
                throw new Error("REFERRAL_NOT_QUALIFIED");
            }

            // 3. Credit through existing Rewards Ledger
            const ledgerResult =
                await rewardsLedger.creditWalletWithConnection(conn, {
                    userId: attribution.referrer_user_id,
                    amount: attribution.reward_credits,
                    source: "referral",
                    idempotencyKey: `referral-attribution:${attribution.id}`,
                    description: "Referral first purchase reward",
                    referenceType: "referral",
                    referenceId: attribution.id,
                    metadata: {
                        attributionId: attribution.id,
                        referralId: attribution.referral_id,
                        paymentId: attribution.payment_id,
                        referredUserId: attribution.referred_user_id,
                        waitDays: attribution.wait_days
                    }
                });

            if (
                !ledgerResult ||
                !ledgerResult.success ||
                !ledgerResult.transactionId
            ) {
                throw new Error("REFERRAL_LEDGER_CREDIT_FAILED");
            }

            const transactionId = ledgerResult.transactionId;

            // 4. Update referral
            const [referralUpdate] = await conn.execute(
                `UPDATE reward_referrals
                 SET status = 'rewarded',
                     reward_transaction_id = ?,
                     rewarded_at = NOW(),
                     rejection_reason = NULL
                 WHERE id = ?
                   AND status = 'qualified'
                   AND reward_transaction_id IS NULL`,
                [transactionId, attribution.referral_id]
            );

            if (!referralUpdate.affectedRows) {
                throw new Error("REFERRAL_UPDATE_FAILED");
            }

            // 5. Update attribution
            const [attributionUpdate] = await conn.execute(
                `UPDATE reward_attributions
                 SET status = 'rewarded',
                     reward_transaction_id = ?,
                     rewarded_at = NOW()
                 WHERE id = ?
                   AND status IN ('waiting', 'eligible')
                   AND reward_transaction_id IS NULL`,
                [transactionId, attribution.id]
            );

            if (!attributionUpdate.affectedRows) {
                throw new Error("ATTRIBUTION_UPDATE_FAILED");
            }

            await conn.commit();

            summary.rewarded++;

            console.log("REFERRAL REWARDED:", {
                attributionId: attribution.id,
                transactionId,
                credits: attribution.reward_credits
            });

        } catch (err) {
            try {
                await conn.rollback();
            } catch (rollbackError) {
                console.error(
                    "REFERRAL ROLLBACK ERROR:",
                    rollbackError.message
                );
            }

            if (!currentAttributionId) {
                throw err;
            }

            summary.failed++;

            summary.errors.push({
                attributionId: currentAttributionId,
                message: err.message
            });

            console.error("REFERRAL PAYOUT FAILED:", {
                attributionId: currentAttributionId,
                error: err.message
            });

        } finally {
            conn.release();
        }
    }

    summary.attempted = attemptedIds.size;

    return summary;
}

module.exports = {
    processDueAttributions
};
