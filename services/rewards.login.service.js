
"use strict";

const db = require("../db");
const rewardsLedger = require("./rewards.ledger.service");

const RULE_KEY = "login_streak";
const SOURCE = "login_streak";
const TIMEZONE = "Asia/Ho_Chi_Minh";

function getLocalDate(timeZone = TIMEZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};
    for (const part of parts) {
        if (part.type !== "literal") values[part.type] = part.value;
    }

    return `${values.year}-${values.month}-${values.day}`;
}

function dateDifference(fromDate, toDate) {
    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T00:00:00Z`);
    return Math.round((to - from) / 86400000);
}

function parseConfig(config) {
    if (!config) return {};

    if (typeof config === "object") return config;

    try {
        return JSON.parse(config);
    } catch {
        return {};
    }
}

function normalizeMilestones(milestones) {
    if (!Array.isArray(milestones)) return [];

    return milestones
        .map(item => ({
            day: Number(item?.day),
            credits: Number(item?.credits)
        }))
        .filter(item =>
            Number.isInteger(item.day) &&
            item.day >= 7 &&
            Number.isSafeInteger(item.credits) &&
            item.credits > 0
        )
        .sort((a, b) => a.day - b.day);
}

async function recordLogin(userId) {
    const normalizedUserId = Number(userId);

    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("INVALID_USER_ID");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // Load reward configuration.
        const [ruleRows] = await conn.execute(
            `SELECT enabled, config
             FROM reward_rules
             WHERE rule_key = ?
             LIMIT 1`,
            [RULE_KEY]
        );

        const rule = ruleRows[0] || null;
        const config = parseConfig(rule?.config);
        const timezone = config.timezone || TIMEZONE;
        const loginDate = getLocalDate(timezone);
        const milestones = normalizeMilestones(config.milestones);

        // Create streak record if it does not exist.
        await conn.execute(
            `INSERT IGNORE INTO reward_login_streaks (user_id)
             VALUES (?)`,
            [normalizedUserId]
        );

        // Lock streak record to prevent concurrent login updates.
        const [streakRows] = await conn.execute(
            `SELECT *
             FROM reward_login_streaks
             WHERE user_id = ?
             FOR UPDATE`,
            [normalizedUserId]
        );

        const streak = streakRows[0];

        // A user can only be counted once per local calendar day.
        const [dayRows] = await conn.execute(
            `SELECT id, streak_day, reward_transaction_id
             FROM reward_login_days
             WHERE user_id = ? AND login_date = ?
             LIMIT 1`,
            [normalizedUserId, loginDate]
        );

        if (dayRows.length) {
            await conn.commit();

            return {
                success: true,
                alreadyRecorded: true,
                loginDate,
                streakDays: Number(dayRows[0].streak_day),
                rewarded: Boolean(dayRows[0].reward_transaction_id)
            };
        }

        let streakDays = 1;

        if (streak.last_login_date) {
            const difference = dateDifference(
                streak.last_login_date,
                loginDate
            );

            if (difference === 1) {
                streakDays = Number(streak.current_streak_days) + 1;
            }
        }

        const longestStreak = Math.max(
            Number(streak.longest_streak_days || 0),
            streakDays
        );

        const milestone = milestones.find(
            item => item.day === streakDays
        );

        let transactionId = null;
        let rewarded = false;

        if (rule?.enabled && milestone) {
            const ledgerResult = await rewardsLedger.creditWalletWithConnection(
                conn,
                {
                    userId: normalizedUserId,
                    amount: milestone.credits,
                    source: SOURCE,
                    idempotencyKey:
                        `login_streak:${normalizedUserId}:${loginDate}:${streakDays}`,
                    referenceType: "reward_login_day",
                    referenceId: `${normalizedUserId}:${loginDate}`,
                    description:
                        `Login streak reward - day ${streakDays}`,
                    metadata: {
                        loginDate,
                        streakDays,
                        milestoneDay: milestone.day,
                        timezone
                    }
                }
            );

            transactionId = ledgerResult.transactionId;
            rewarded = true;
        }

        await conn.execute(
            `INSERT INTO reward_login_days
                (
                    user_id,
                    login_date,
                    streak_day,
                    reward_milestone,
                    reward_transaction_id
                )
             VALUES (?, ?, ?, ?, ?)`,
            [
                normalizedUserId,
                loginDate,
                streakDays,
                rewarded ? milestone.day : null,
                transactionId
            ]
        );

        await conn.execute(
            `UPDATE reward_login_streaks
             SET current_streak_days = ?,
                 longest_streak_days = ?,
                 last_login_date = ?,
                 last_rewarded_milestone = ?
             WHERE user_id = ?`,
            [
                streakDays,
                longestStreak,
                loginDate,
                rewarded
                    ? milestone.day
                    : (streakDays === 1
                        ? 0
                        : Number(streak.last_rewarded_milestone || 0)),
                normalizedUserId
            ]
        );

        await conn.commit();

        return {
            success: true,
            alreadyRecorded: false,
            loginDate,
            streakDays,
            longestStreak,
            rewarded,
            rewardCredits: rewarded ? milestone.credits : 0,
            rewardTransactionId: transactionId
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    recordLogin
};
