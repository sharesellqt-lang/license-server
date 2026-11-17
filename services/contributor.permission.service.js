
"use strict";

const db = require("../db");

function validateUserId(userId) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid user ID");
    }
    return id;
}

function validatePermissionKey(permissionKey) {
    if (
        typeof permissionKey !== "string" ||
        !/^[a-z][a-z0-9_.-]{1,99}$/.test(permissionKey)
    ) {
        throw new Error("Invalid permission key");
    }
    return permissionKey;
}

// Super Admin được xác định từ hệ thống admin hiện tại.
async function isSuperAdmin(userId) {
    const id = validateUserId(userId);

    const [rows] = await db.execute(
        `SELECT 1
         FROM users u
         INNER JOIN admin a
            ON LOWER(a.email) = LOWER(u.email)
         INNER JOIN admin_permissions ap
            ON ap.admin_id = a.id
         WHERE u.id = ?
           AND ap.permission = 'super_admin'
         LIMIT 1`,
        [id]
    );

    return rows.length > 0;
}

async function hasPermission(userId, permissionKey) {
    const id = validateUserId(userId);
    const key = validatePermissionKey(permissionKey);

    // Super Admin bypass toàn bộ Permission thông thường.
    if (await isSuperAdmin(id)) return true;

    // Kiểm tra quyền tùy chỉnh trực tiếp của User.
    const [customRows] = await db.execute(
        `SELECT cup.effect
         FROM contributor_user_permissions cup
         INNER JOIN contributor_permissions p
            ON p.id = cup.permission_id
         WHERE cup.user_id = ?
           AND p.permission_key = ?
           AND (cup.expires_at IS NULL OR cup.expires_at > NOW())
         LIMIT 1`,
        [id, key]
    );

    if (customRows.length) {
        // Deny luôn được ưu tiên hơn Role.
        return customRows[0].effect === "allow";
    }

    // Kiểm tra quyền được kế thừa từ Role.
    const [roleRows] = await db.execute(
        `SELECT 1
         FROM contributor_user_roles ur
         INNER JOIN contributor_roles r
            ON r.id = ur.role_id
         INNER JOIN contributor_role_permissions rp
            ON rp.role_id = r.id
         INNER JOIN contributor_permissions p
            ON p.id = rp.permission_id
         WHERE ur.user_id = ?
           AND p.permission_key = ?
           AND r.enabled = 1
           AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
         LIMIT 1`,
        [id, key]
    );

    return roleRows.length > 0;
}

async function getUserPermissions(userId) {
    const id = validateUserId(userId);

    if (await isSuperAdmin(id)) {
        const [rows] = await db.execute(
            `SELECT permission_key, category
             FROM contributor_permissions
             ORDER BY category, permission_key`
        );

        return {
            isSuperAdmin: true,
            permissions: rows.map(row => row.permission_key)
        };
    }

    const [rows] = await db.execute(
        `SELECT permission_key, category
         FROM (
             SELECT p.permission_key, p.category, 1 AS priority
             FROM contributor_user_roles ur
             INNER JOIN contributor_roles r
                ON r.id = ur.role_id
             INNER JOIN contributor_role_permissions rp
                ON rp.role_id = r.id
             INNER JOIN contributor_permissions p
                ON p.id = rp.permission_id
             WHERE ur.user_id = ?
               AND r.enabled = 1
               AND (ur.expires_at IS NULL OR ur.expires_at > NOW())

             UNION ALL

             SELECT p.permission_key, p.category,
                    IF(cup.effect = 'deny', 3, 2) AS priority
             FROM contributor_user_permissions cup
             INNER JOIN contributor_permissions p
                ON p.id = cup.permission_id
             WHERE cup.user_id = ?
               AND (cup.expires_at IS NULL OR cup.expires_at > NOW())
         ) permission_list
         GROUP BY permission_key, category
         HAVING MAX(priority) < 3
         ORDER BY category, permission_key`,
        [id, id]
    );

    return {
        isSuperAdmin: false,
        permissions: rows.map(row => row.permission_key)
    };
}

module.exports = {
    isSuperAdmin,
    hasPermission,
    getUserPermissions
};
