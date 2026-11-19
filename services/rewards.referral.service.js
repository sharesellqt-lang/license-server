
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

module.exports = { processGoogleLogin };
