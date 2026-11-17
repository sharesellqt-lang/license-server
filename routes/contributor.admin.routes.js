
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const rbacService = require("../services/contributor.rbac.admin.service");
const taskService = require("../services/contributor.task.service");

function handleError(res, err, label = "ADMIN") {
    console.error(`[CONTRIBUTOR ${label}]`, err);

    const errors = {
        INVALID_USER_ID: 400,
        INVALID_ROLE_KEY: 400,
        INVALID_PERMISSION_KEY: 400,
        INVALID_PERMISSION_EFFECT: 400,
        INVALID_TITLE: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_CATEGORY: 400,
        INVALID_REWARD: 400,
        INVALID_MAX_PARTICIPANTS: 400,
        INVALID_DEADLINE: 400,
        INVALID_TASK_ID: 400,
        TARGET_USER_NOT_FOUND: 404,
        ROLE_NOT_FOUND: 404,
        PERMISSION_NOT_FOUND: 404,
        TASK_NOT_FOUND: 404,
        TASK_CANNOT_BE_PUBLISHED: 409
    };

    const status = errors[err.message] || 500;

    return res.status(status).json({
        success: false,
        error: status === 500
            ? "CONTRIBUTOR_ADMIN_OPERATION_FAILED"
            : err.message
    });
}

function getAuditInfo(req) {
    return {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null
    };
}

// Tất cả API quản trị đều cần xác thực.
router.use(auth);

// ========================================
// RBAC MANAGEMENT - roles.manage
// ========================================

// GET /api/contributor/admin/roles
router.get(
    "/roles",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const roles = await rbacService.getRoles();
            return res.json({ success: true, roles });
        } catch (err) {
            return handleError(res, err, "GET ROLES");
        }
    }
);

// GET /api/contributor/admin/permissions
router.get(
    "/permissions",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const permissions = await rbacService.getPermissions();
            return res.json({ success: true, permissions });
        } catch (err) {
            return handleError(res, err, "GET PERMISSIONS");
        }
    }
);

// GET /api/contributor/admin/users/:userId/access
router.get(
    "/users/:userId/access",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const access = await rbacService.getUserAccess(req.params.userId);

            return res.json({ success: true, access });
        } catch (err) {
            return handleError(res, err, "GET USER ACCESS");
        }
    }
);

// PUT /api/contributor/admin/users/:userId/roles/:roleKey
router.put(
    "/users/:userId/roles/:roleKey",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const result = await rbacService.assignRole(
                req.user.id,
                req.params.userId,
                req.params.roleKey,
                getAuditInfo(req)
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "ASSIGN ROLE");
        }
    }
);

// DELETE /api/contributor/admin/users/:userId/roles/:roleKey
router.delete(
    "/users/:userId/roles/:roleKey",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const result = await rbacService.revokeRole(
                req.user.id,
                req.params.userId,
                req.params.roleKey,
                getAuditInfo(req)
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "REVOKE ROLE");
        }
    }
);

// PUT /api/contributor/admin/users/:userId/permissions/:permissionKey
router.put(
    "/users/:userId/permissions/:permissionKey",
    requireContributorPermission("roles.manage"),
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

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "SET USER PERMISSION");
        }
    }
);

// DELETE /api/contributor/admin/users/:userId/permissions/:permissionKey
router.delete(
    "/users/:userId/permissions/:permissionKey",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const result = await rbacService.removeUserPermission(
                req.user.id,
                req.params.userId,
                req.params.permissionKey,
                getAuditInfo(req)
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "REMOVE USER PERMISSION");
        }
    }
);

// ========================================
// TASK MANAGEMENT
// ========================================

// POST /api/contributor/admin/tasks
router.post(
    "/tasks",
    requireContributorPermission("task.create"),
    async (req, res) => {
        try {
            const task = await taskService.createTask({
                ...req.body,
                createdByUserId: req.user.id
            });

            return res.status(201).json({
                success: true,
                task
            });
        } catch (err) {
            return handleError(res, err, "CREATE TASK");
        }
    }
);

// POST /api/contributor/admin/tasks/:id/publish
router.post(
    "/tasks/:id/publish",
    requireContributorPermission("task.publish"),
    async (req, res) => {
        try {
            const task = await taskService.publishTask(req.params.id);

            return res.json({
                success: true,
                task
            });
        } catch (err) {
            return handleError(res, err, "PUBLISH TASK");
        }
    }
);

module.exports = router;
