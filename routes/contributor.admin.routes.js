
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const rbacService = require("../services/contributor.rbac.admin.service");

router.use(auth, requireContributorPermission("roles.manage"));

function handleError(res, err) {
    console.error("[CONTRIBUTOR RBAC]", err);

    const errors = {
        INVALID_USER_ID: 400,
        INVALID_ROLE_KEY: 400,
        INVALID_PERMISSION_KEY: 400,
        INVALID_PERMISSION_EFFECT: 400,
        TARGET_USER_NOT_FOUND: 404,
        ROLE_NOT_FOUND: 404,
        PERMISSION_NOT_FOUND: 404
    };

    const status = errors[err.message] || 500;

    return res.status(status).json({
        success: false,
        error: status === 500
            ? "CONTRIBUTOR_RBAC_OPERATION_FAILED"
            : err.message
    });
}

function getAuditInfo(req) {
    return {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null
    };
}

// GET /api/contributor/admin/roles
router.get("/roles", async (req, res) => {
    try {
        const roles = await rbacService.getRoles();
        return res.json({ success: true, roles });
    } catch (err) {
        return handleError(res, err);
    }
});

// GET /api/contributor/admin/permissions
router.get("/permissions", async (req, res) => {
    try {
        const permissions = await rbacService.getPermissions();
        return res.json({ success: true, permissions });
    } catch (err) {
        return handleError(res, err);
    }
});

// GET /api/contributor/admin/users/:userId/access
router.get("/users/:userId/access", async (req, res) => {
    try {
        const access = await rbacService.getUserAccess(req.params.userId);

        return res.json({
            success: true,
            access
        });
    } catch (err) {
        return handleError(res, err);
    }
});

// PUT /api/contributor/admin/users/:userId/roles/:roleKey
router.put("/users/:userId/roles/:roleKey", async (req, res) => {
    try {
        const result = await rbacService.assignRole(
            req.user.id,
            req.params.userId,
            req.params.roleKey,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (err) {
        return handleError(res, err);
    }
});

// DELETE /api/contributor/admin/users/:userId/roles/:roleKey
router.delete("/users/:userId/roles/:roleKey", async (req, res) => {
    try {
        const result = await rbacService.revokeRole(
            req.user.id,
            req.params.userId,
            req.params.roleKey,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (err) {
        return handleError(res, err);
    }
});

// PUT /api/contributor/admin/users/:userId/permissions/:permissionKey
router.put(
    "/users/:userId/permissions/:permissionKey",
    async (req, res) => {
        try {
            const result = await rbacService.setUserPermission(
                req.user.id,
                req.params.userId,
                req.params.permissionKey,
                req.body.effect,
                req.body.reason,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                ...result
            });
        } catch (err) {
            return handleError(res, err);
        }
    }
);

// DELETE /api/contributor/admin/users/:userId/permissions/:permissionKey
router.delete(
    "/users/:userId/permissions/:permissionKey",
    async (req, res) => {
        try {
            const result = await rbacService.removeUserPermission(
                req.user.id,
                req.params.userId,
                req.params.permissionKey,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                ...result
            });
        } catch (err) {
            return handleError(res, err);
        }
    }
);

module.exports = router;
