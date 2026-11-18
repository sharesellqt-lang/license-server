
"use strict";

const db = require("../db");
const rbacService = require("./contributor.rbac.admin.service");

function positiveId(value, error = "INVALID_USER_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }
    return id;
}

function validPage(value, fallback, max) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) return fallback;
    return Math.min(number, max);
}

function validSearch(value) {
    return typeof value === "string"
        ? value.trim().slice(0, 255)
        : "";
}

async function getMembers(query = {}) {
    const page = validPage(query.page, 1, 1000000);
    const limit = validPage(query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const search = validSearch(query.search);
    const role = validSearch(query.role);
    const plan = validSearch(query.plan);

    const conditions = [];
    const params = [];

    if (search) {
        if (/^#?\d+$/.test(search)) {
            conditions.push("(u.id = ? OR u.email LIKE ?)");
            params.push(Number(search.replace("#", "")), `%${search}%`);
        } else {
            conditions.push("u.email LIKE ?");
            params.push(`%${search}%`);
        }
    }

    if (role) {
        conditions.push(`EXISTS (
            SELECT 1
            FROM contributor_user_roles ur
            INNER JOIN contributor_roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id
              AND r.role_key = ?
              AND r.enabled = 1
              AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        )`);
        params.push(role);
    }

    if (["free", "pro", "vip"].includes(plan)) {
        conditions.push("u.plan = ?");
        params.push(plan);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM users u
         ${where}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            u.id,
            u.email,
            u.plan,
            u.expire_at,
            u.created_at,

            COALESCE(w.balance, 0) AS credits_balance,
            COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
            COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
            COALESCE(w.status, 'no_wallet') AS wallet_status,

            (
                SELECT COUNT(*)
                FROM contributor_task_assignments a
                WHERE a.user_id = u.id
            ) AS total_assignments,

            (
                SELECT COUNT(*)
                FROM contributor_task_assignments a
                WHERE a.user_id = u.id
                  AND a.status = 'completed'
            ) AS completed_assignments,

            (
                SELECT COUNT(*)
                FROM contributor_submissions s
                INNER JOIN contributor_task_assignments a
                    ON a.id = s.assignment_id
                WHERE a.user_id = u.id
            ) AS total_submissions,

            (
                SELECT COUNT(*)
                FROM contributor_submissions s
                INNER JOIN contributor_task_assignments a
                    ON a.id = s.assignment_id
                WHERE a.user_id = u.id
                  AND s.status = 'approved'
            ) AS approved_submissions,

            (
                SELECT GROUP_CONCAT(
                    DISTINCT r.role_key
                    ORDER BY r.role_key
                    SEPARATOR ','
                )
                FROM contributor_user_roles ur
                INNER JOIN contributor_roles r
                    ON r.id = ur.role_id
                WHERE ur.user_id = u.id
                  AND r.enabled = 1
                  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            ) AS roles

         FROM users u
         LEFT JOIN reward_wallets w ON w.user_id = u.id
         ${where}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    return {
        members: rows,
        pagination: {
            page,
            limit,
            total: Number(countRows[0].total || 0),
            totalPages: Math.ceil(
                Number(countRows[0].total || 0) / limit
            )
        }
    };
}

async function getMemberDetail(userId) {
    const id = positiveId(userId);

    const [rows] = await db.execute(
        `SELECT
            u.id,
            u.email,
            u.plan,
            u.expire_at,
            u.created_at,
            u.cycle,

            COALESCE(w.balance, 0) AS credits_balance,
            COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
            COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
            COALESCE(w.status, 'no_wallet') AS wallet_status,
            w.created_at AS wallet_created_at

         FROM users u
         LEFT JOIN reward_wallets w ON w.user_id = u.id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) throw new Error("TARGET_USER_NOT_FOUND");

    const [assignments] = await db.execute(
        `SELECT
            a.id,
            a.task_id,
            t.title AS task_title,
            a.status,
            a.accepted_at,
            a.completed_at,
            a.cancelled_at
         FROM contributor_task_assignments a
         INNER JOIN contributor_tasks t ON t.id = a.task_id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 100`,
        [id]
    );

    const [submissions] = await db.execute(
        `SELECT
            s.id,
            s.assignment_id,
            s.attempt_no,
            s.status,
            s.submitted_at,
            s.reviewed_at,
            t.title AS task_title
         FROM contributor_submissions s
         INNER JOIN contributor_task_assignments a
            ON a.id = s.assignment_id
         INNER JOIN contributor_tasks t ON t.id = a.task_id
         WHERE a.user_id = ?
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 100`,
        [id]
    );

    const access = await rbacService.getUserAccess(id);

    return {
        member: rows[0],
        access,
        assignments,
        submissions
    };
}

async function getMemberActivity(userId, query = {}) {
    const id = positiveId(userId);
    const page = validPage(query.page, 1, 1000000);
    const limit = validPage(query.limit, 20, 100);
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_audit_logs
         WHERE target_user_id = ?`,
        [id]
    );

    const [rows] = await db.execute(
        `SELECT
            id,
            actor_user_id,
            target_user_id,
            action,
            entity_type,
            entity_id,
            old_data,
            new_data,
            ip_address,
            created_at
         FROM contributor_audit_logs
         WHERE target_user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [id]
    );

    return {
        activities: rows,
        pagination: {
            page,
            limit,
            total: Number(countRows[0].total || 0),
            totalPages: Math.ceil(
                Number(countRows[0].total || 0) / limit
            )
        }
    };
}

async function getMemberTransactions(userId, query = {}) {
    const id = positiveId(userId);
    const page = validPage(query.page, 1, 1000000);
    const limit = validPage(query.limit, 20, 100);
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM reward_transactions
         WHERE user_id = ?`,
        [id]
    );

    const [rows] = await db.execute(
        `SELECT
            id,
            type,
            source,
            amount,
            balance_before,
            balance_after,
            reference_type,
            reference_id,
            description,
            created_at
         FROM reward_transactions
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [id]
    );

    return {
        transactions: rows,
        pagination: {
            page,
            limit,
            total: Number(countRows[0].total || 0),
            totalPages: Math.ceil(
                Number(countRows[0].total || 0) / limit
            )
        }
    };
}

module.exports = {
    getMembers,
    getMemberDetail,
    getMemberActivity,
    getMemberTransactions
};
