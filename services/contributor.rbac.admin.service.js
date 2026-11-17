
"use strict";

const { db } = require("../db");
const permissionService = require("./contributor.permission.service");

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

async function writeAudit(conn, data) {
    await conn.execute(
        `INSERT INTO contributor_audit_logs
         (actor_user_id, target_user_id, action, entity_type,
          entity_id, old_data, new_data, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.actorUserId,
            data.targetUserId,
            data.action,
            data.entityType,
            data.entityId || null,
            data.oldData ? JSON.stringify(data.oldData) : null,
            data.newData ? JSON.stringify(data.newData) : null,
            data.ipAddress || null,
            data.userAgent || null
        ]
    );
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
            actorUserId: actorId,
            targetUserId: targetId,
            action: "role.assigned",
            entityType: "role",
            entityId: role.role_key,
            newData: { roleKey: role.role_key, roleName: role.name },
            ...audit
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
                actorUserId: actorId,
                targetUserId: targetId,
                action: "role.revoked",
                entityType: "role",
                entityId: role.role_key,
                oldData: { roleKey: role.role_key, roleName: role.name },
                ...audit
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
            actorUserId: actorId,
            targetUserId: targetId,
            action: "permission.updated",
            entityType: "permission",
            entityId: permission.permission_key,
            oldData,
            newData: { effect, reason: reason || null },
            ...audit
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
                actorUserId: actorId,
                targetUserId: targetId,
                action: "permission.removed",
                entityType: "permission",
                entityId: key,
                oldData,
                ...audit
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

module.exports = {
    getRoles,
    getPermissions,
    assignRole,
    revokeRole,
    setUserPermission,
    removeUserPermission,
    getUserAccess
};
