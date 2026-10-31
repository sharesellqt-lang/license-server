"use strict";

const db = require("../db");

function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            if (!req.adminId) {
                return res.status(401).json({
                    error: "Unauthorized"
                });
            }

            const [rows] = await db.execute(
                `SELECT 1
                 FROM admin_permissions
                 WHERE admin_id = ?
                   AND permission IN (?, 'super_admin')
                 LIMIT 1`,
                [req.adminId, permission]
            );

            if (!rows.length) {
                return res.status(403).json({
                    error: "Permission denied"
                });
            }

            next();
        } catch (err) {
            console.error("[ADMIN PERMISSION]", err);

            return res.status(500).json({
                error: "Permission check failed"
            });
        }
    };
}

module.exports = requirePermission;