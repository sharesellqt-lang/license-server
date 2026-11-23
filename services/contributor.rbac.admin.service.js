
"use strict";

const db = require("../db");
const permissionService = require("./contributor.permission.service");
const { writeAudit } = require("./contributor.audit.service");

function positiveId(value, error = "INVALID_USER_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(error);
    return id;
}

function validKey(value, error) {
    if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{1,99}$/.test(value)) {
        throw new Error(error);
    }
    return value;
}

async function getRoles() {
    const [rows] = await db.execute(
        `SELECT
            r.id, r.role_key, r.name, r.description, r.enabled,
            COUNT(rp.permission_id) AS total_permissions
         FROM contributor_roles r
         LEFT JOIN contributor_role_permissions rp ON rp.role_id = r.id
         GROUP BY r.id, r.role_key, r.name, r.description, r.enabled
         ORDER BY r.id`
    );
    return rows;
}

async function getPermissions() {
    const [rows] = await db.execute(
        `SELECT id, permission_key, name, description, category
         FROM contributor_permissions
         ORDER BY category, permission_key`
    );
    return rows;
}


async function assignRoleWithConnection(
    conn,
    actorUserId,
    targetUserId,
    roleKey,
    audit = {}
) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_RBAC_CONNECTION");
    }

    const actorId = positiveId(actorUserId);
    const targetId = positiveId(targetUserId);
    const key = validKey(roleKey, "INVALID_ROLE_KEY");

    const [users] = await conn.execute(
        "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [targetId]
    );

    if (!users.length) throw new Error("TARGET_USER_NOT_FOUND");

    const [roles] = await conn.execute(
        `SELECT id, role_key, name
         FROM contributor_roles
         WHERE role_key = ? AND enabled = 1
         LIMIT 1`,
        [key]
    );

    if (!roles.length) throw new Error("ROLE_NOT_FOUND");

    const role = roles[0];

    const [existing] = await conn.execute(
        `SELECT id
         FROM contributor_user_roles
         WHERE user_id = ? AND role_id = ?
         LIMIT 1`,
        [targetId, role.id]
    );

    if (existing.length) {
        return { assigned: false, alreadyAssigned: true, role };
    }

    await conn.execute(
        `INSERT INTO contributor_user_roles
         (user_id, role_id, assigned_by_user_id)
         VALUES (?, ?, ?)`,
        [targetId, role.id, actorId]
    );

    await writeAudit(conn, {
        ...audit,
        actorUserId: actorId,
        targetUserId: targetId,
        action: "role.assigned",
        entityType: "role",
        entityId: role.role_key,
        newData: {
            roleKey: role.role_key,
            roleName: role.name,
            source: "marketplace_seller_activation"
        }
    });

    return { assigned: true, role };
}

async function assignRole(actorUserId, targetUserId, roleKey, audit = {}) {
    const actorId = positiveId(actorUserId);
    const targetId = positiveId(targetUserId);
    const key = validKey(roleKey, "INVALID_ROLE_KEY");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [users] = await conn.execute(
            "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
            [targetId]
        );
        if (!users.length) throw new Error("TARGET_USER_NOT_FOUND");

        const [roles] = await conn.execute(
            `SELECT id, role_key, name
             FROM contributor_roles
             WHERE role_key = ? AND enabled = 1
             LIMIT 1`,
            [key]
        );
        if (!roles.length) throw new Error("ROLE_NOT_FOUND");

        const role = roles[0];

        const [existing] = await conn.execute(
            `SELECT id FROM contributor_user_roles
             WHERE user_id = ? AND role_id = ?
             LIMIT 1`,
            [targetId, role.id]
        );

        if (existing.length) {
            await conn.commit();
            return { assigned: false, alreadyAssigned: true };
        }

        await conn.execute(
            `INSERT INTO contributor_user_roles
             (user_id, role_id, assigned_by_user_id)
             VALUES (?, ?, ?)`,
            [targetId, role.id, actorId]
        );

        await writeAudit(conn, {
            ...audit,
            actorUserId: actorId,
            targetUserId: targetId,
            action: "role.assigned",
            entityType: "role",
            entityId: role.role_key,
            newData: { roleKey: role.role_key, roleName: role.name }
        });

        await conn.commit();
        return { assigned: true, role };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function revokeRole(actorUserId, targetUserId, roleKey, audit = {}) {
    const actorId = positiveId(actorUserId);
    const targetId = positiveId(targetUserId);
    const key = validKey(roleKey, "INVALID_ROLE_KEY");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [users] = await conn.execute(
            "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
            [targetId]
        );
        if (!users.length) throw new Error("TARGET_USER_NOT_FOUND");

        const [roles] = await conn.execute(
            "SELECT id, role_key, name FROM contributor_roles WHERE role_key = ? LIMIT 1",
            [key]
        );
        if (!roles.length) throw new Error("ROLE_NOT_FOUND");

        const role = roles[0];

        const [result] = await conn.execute(
            `DELETE FROM contributor_user_roles
             WHERE user_id = ? AND role_id = ?`,
            [targetId, role.id]
        );

       if (result.affectedRows) {
            await writeAudit(conn, {
                ...audit,
                actorUserId: actorId,
                targetUserId: targetId,
                action: "role.revoked",
                entityType: "role",
                entityId: role.role_key,
                oldData: { roleKey: role.role_key, roleName: role.name }
            });
        }

        await conn.commit();
        return { revoked: result.affectedRows > 0 };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function setUserPermission(
    actorUserId,
    targetUserId,
    permissionKey,
    effect,
    reason,
    audit = {}
) {
    const actorId = positiveId(actorUserId);
    const targetId = positiveId(targetUserId);
    const key = validKey(permissionKey, "INVALID_PERMISSION_KEY");

    if (!["allow", "deny"].includes(effect)) {
        throw new Error("INVALID_PERMISSION_EFFECT");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [users] = await conn.execute(
            "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
            [targetId]
        );
        if (!users.length) throw new Error("TARGET_USER_NOT_FOUND");

        const [permissions] = await conn.execute(
            `SELECT id, permission_key
             FROM contributor_permissions
             WHERE permission_key = ?
             LIMIT 1`,
            [key]
        );
        if (!permissions.length) throw new Error("PERMISSION_NOT_FOUND");

        const permission = permissions[0];

        const [oldRows] = await conn.execute(
            `SELECT effect, reason, expires_at
             FROM contributor_user_permissions
             WHERE user_id = ? AND permission_id = ?
             LIMIT 1`,
            [targetId, permission.id]
        );

        const oldData = oldRows[0] || null;

        await conn.execute(
            `INSERT INTO contributor_user_permissions
             (user_id, permission_id, effect, granted_by_user_id, reason)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                effect = VALUES(effect),
                granted_by_user_id = VALUES(granted_by_user_id),
                reason = VALUES(reason),
                expires_at = NULL`,
            [targetId, permission.id, effect, actorId, reason || null]
        );

        await writeAudit(conn, {
            ...audit,
            actorUserId: actorId,
            targetUserId: targetId,
            action: "permission.updated",
            entityType: "permission",
            entityId: permission.permission_key,
            oldData,
            newData: { effect, reason: reason || null }
        });
        await conn.commit();
        return { permission: key, effect };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function removeUserPermission(
    actorUserId,
    targetUserId,
    permissionKey,
    audit = {}
) {
    const actorId = positiveId(actorUserId);
    const targetId = positiveId(targetUserId);
    const key = validKey(permissionKey, "INVALID_PERMISSION_KEY");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [users] = await conn.execute(
            "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
            [targetId]
        );

        if (!users.length) throw new Error("TARGET_USER_NOT_FOUND");

        const [permissions] = await conn.execute(
            "SELECT id FROM contributor_permissions WHERE permission_key = ? LIMIT 1",
            [key]
        );
        if (!permissions.length) throw new Error("PERMISSION_NOT_FOUND");

        const permissionId = permissions[0].id;

        const [oldRows] = await conn.execute(
            `SELECT effect, reason, expires_at
             FROM contributor_user_permissions
             WHERE user_id = ? AND permission_id = ?
             LIMIT 1`,
            [targetId, permissionId]
        );

        const oldData = oldRows[0] || null;

        const [result] = await conn.execute(
            `DELETE FROM contributor_user_permissions
             WHERE user_id = ? AND permission_id = ?`,
            [targetId, permissionId]
        );
        if (result.affectedRows) {
            await writeAudit(conn, {
                ...audit,
                actorUserId: actorId,
                targetUserId: targetId,
                action: "permission.removed",
                entityType: "permission",
                entityId: key,
                oldData
            });
        }

        await conn.commit();
        return { removed: result.affectedRows > 0 };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function getUserAccess(userId) {
    const id = positiveId(userId);

    const [roles] = await db.execute(
        `SELECT r.role_key, r.name, ur.assigned_at, ur.expires_at
         FROM contributor_user_roles ur
         INNER JOIN contributor_roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?
           AND r.enabled = 1
           AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
         ORDER BY r.name`,
        [id]
    );

    const [customPermissions] = await db.execute(
        `SELECT p.permission_key, p.name, cup.effect,
                cup.reason, cup.expires_at
         FROM contributor_user_permissions cup
         INNER JOIN contributor_permissions p
            ON p.id = cup.permission_id
         WHERE cup.user_id = ?
           AND (cup.expires_at IS NULL OR cup.expires_at > NOW())
         ORDER BY p.category, p.permission_key`,
        [id]
    );

    const access = await permissionService.getUserPermissions(id);

    return {
        isSuperAdmin: access.isSuperAdmin,
        roles,
        customPermissions,
        permissions: access.permissions
    };
}


function positiveNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min
        ? Math.min(number, max)
        : fallback;
}

async function getMembers(params = {}) {
    const page = positiveNumber(params.page, 1, 1, 1000000);
    const limit = positiveNumber(params.limit, 20, 1, 100);
    const offset = (page - 1) * limit;

    const search = String(params.search || "").trim().slice(0, 255);
    const roleKey = params.role ? validKey(params.role, "INVALID_ROLE_KEY") : null;
    const plan = ["free", "pro", "vip"].includes(params.plan)
        ? params.plan
        : null;

    const where = [];
    const values = [];

    if (search) {
        if (/^\d+$/.test(search)) {
            where.push("(u.id = ? OR u.email LIKE ?)");
            values.push(Number(search), `%${search}%`);
        } else {
            where.push("u.email LIKE ?");
            values.push(`%${search}%`);
        }
    }

    if (plan) {
        where.push("u.plan = ?");
        values.push(plan);
    }

    if (roleKey) {
        where.push(`EXISTS (
            SELECT 1
            FROM contributor_user_roles ur
            INNER JOIN contributor_roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id
              AND r.role_key = ?
              AND r.enabled = 1
              AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        )`);
        values.push(roleKey);
    }

    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM users u
         ${condition}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            u.id AS user_id,
            u.email,
            u.plan,
            u.expire_at,
            u.created_at,

            COALESCE(w.balance, 0) AS credits_balance,
            COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
            COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
            COALESCE(w.status, 'none') AS wallet_status,

            COALESCE(a.accepted_count, 0) AS accepted_count,
            COALESCE(a.submitted_count, 0) AS assignment_submitted_count,
            COALESCE(a.completed_count, 0) AS completed_count,
            COALESCE(a.rejected_count, 0) AS assignment_rejected_count,
            COALESCE(a.cancelled_count, 0) AS cancelled_count,

            COALESCE(s.total_submissions, 0) AS total_submissions,
            COALESCE(s.approved_count, 0) AS approved_count,
            COALESCE(s.rejected_count, 0) AS submission_rejected_count,
            COALESCE(s.revision_count, 0) AS revision_count,
            COALESCE(s.pending_count, 0) AS pending_count,

            COALESCE(r.roles, '') AS roles

         FROM users u

         LEFT JOIN reward_wallets w ON w.user_id = u.id

         LEFT JOIN (
            SELECT
                user_id,
                SUM(status = 'accepted') AS accepted_count,
                SUM(status = 'submitted') AS submitted_count,
                SUM(status = 'completed') AS completed_count,
                SUM(status = 'rejected') AS rejected_count,
                SUM(status = 'cancelled') AS cancelled_count
            FROM contributor_task_assignments
            GROUP BY user_id
         ) a ON a.user_id = u.id

         LEFT JOIN (
            SELECT
                ta.user_id,
                COUNT(s.id) AS total_submissions,
                SUM(s.status = 'approved') AS approved_count,
                SUM(s.status = 'rejected') AS rejected_count,
                SUM(s.status = 'revision_requested') AS revision_count,
                SUM(s.status IN ('submitted', 'under_review')) AS pending_count
            FROM contributor_task_assignments ta
            INNER JOIN contributor_submissions s
                ON s.assignment_id = ta.id
            GROUP BY ta.user_id
         ) s ON s.user_id = u.id

         LEFT JOIN (
            SELECT
                ur.user_id,
                GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
            FROM contributor_user_roles ur
            INNER JOIN contributor_roles r ON r.id = ur.role_id
            WHERE r.enabled = 1
              AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            GROUP BY ur.user_id
         ) r ON r.user_id = u.id

         ${condition}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    return {
        members: rows,
        pagination: {
            page,
            limit,
            total: Number(count.total),
            totalPages: Math.ceil(Number(count.total) / limit)
        }
    };
}

async function getMemberDetail(userId) {
    const id = positiveId(userId);

    const [rows] = await db.execute(
        `SELECT
            u.id AS user_id,
            u.email,
            u.plan,
            u.expire_at,
            u.created_at,
            COALESCE(w.balance, 0) AS credits_balance,
            COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
            COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
            COALESCE(w.status, 'none') AS wallet_status
         FROM users u
         LEFT JOIN reward_wallets w ON w.user_id = u.id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) throw new Error("MEMBER_NOT_FOUND");

    const access = await getUserAccess(id);

    const [[assignments]] = await db.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'accepted') AS accepted,
            SUM(status = 'submitted') AS submitted,
            SUM(status = 'completed') AS completed,
            SUM(status = 'rejected') AS rejected,
            SUM(status = 'cancelled') AS cancelled
         FROM contributor_task_assignments
         WHERE user_id = ?`,
        [id]
    );

    const [[submissions]] = await db.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'submitted') AS submitted,
            SUM(status = 'under_review') AS under_review,
            SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected,
            SUM(status = 'revision_requested') AS revision_requested
         FROM contributor_submissions s
         INNER JOIN contributor_task_assignments a
            ON a.id = s.assignment_id
         WHERE a.user_id = ?`,
        [id]
    );

    return {
        member: rows[0],
        access,
        assignments,
        submissions
    };
}


module.exports = {
    getRoles,
    getPermissions,
    assignRole,
    assignRoleWithConnection,
    revokeRole,
    setUserPermission,
    removeUserPermission,
    getUserAccess,
    getMembers,
    getMemberDetail,
};
