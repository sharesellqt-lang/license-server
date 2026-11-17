
"use strict";

const {
    hasPermission
} = require("../services/contributor.permission.service");

function requireContributorPermission(permissionKey) {
    return async function (req, res, next) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required"
                });
            }

            const allowed = await hasPermission(
                userId,
                permissionKey
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    code: "CONTRIBUTOR_PERMISSION_DENIED",
                    message: "Bạn không có quyền thực hiện thao tác này",
                    requiredPermission: permissionKey
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = requireContributorPermission;
