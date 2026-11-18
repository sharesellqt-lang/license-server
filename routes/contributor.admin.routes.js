
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const rbacService = require("../services/contributor.rbac.admin.service");
const taskService = require("../services/contributor.task.service");

router.use(auth);

function handleError(res, err, label = "ADMIN") {
    console.error(`[CONTRIBUTOR ${label}]`, err);

    const errors = {
        INVALID_USER_ID: 400,
        INVALID_ROLE_KEY: 400,
        INVALID_PERMISSION_KEY: 400,
        INVALID_EFFECT: 400,
        INVALID_TASK_ID: 400,
        INVALID_TITLE: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_CATEGORY: 400,
        INVALID_REWARD: 400,
        INVALID_MAX_PARTICIPANTS: 400,
        INVALID_DEADLINE: 400,
        INVALID_DATA: 400,

        TARGET_USER_NOT_FOUND: 404,
        ROLE_NOT_FOUND: 404,
        PERMISSION_NOT_FOUND: 404,
        TASK_NOT_FOUND: 404,

        TASK_CANNOT_BE_PUBLISHED: 409,
        TASK_CANNOT_BE_PAUSED: 409,
        TASK_CANNOT_BE_RESUMED: 409,
        TASK_CANNOT_BE_CLOSED: 409,
        INVALID_SUBMISSION_ID: 400,
        INVALID_PAGE: 400,
        INVALID_LIMIT: 400,

        SUBMISSION_NOT_FOUND: 404,
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

// =========================
// RBAC
// =========================

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

router.get(
    "/users/:userId/access",
    requireContributorPermission("roles.manage"),
    async (req, res) => {
        try {
            const access = await rbacService.getUserAccess(
                req.params.userId
            );

            return res.json({ success: true, access });
        } catch (err) {
            return handleError(res, err, "GET USER ACCESS");
        }
    }
);

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

// =========================
// TASK MANAGEMENT
// =========================

// GET /api/contributor/admin/tasks
router.get(
    "/tasks",
    requireContributorPermission("task.view"),
    async (req, res) => {
        try {
            const result = await taskService.getAdminTasks(req.query);
            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET ADMIN TASKS");
        }
    }
);

// GET /api/contributor/admin/tasks/:id/assignments
router.get(
    "/tasks/:id/assignments",
    requireContributorPermission("task.view"),
    async (req, res) => {
        try {
            const assignments = await taskService.getTaskAssignments(
                req.params.id
            );

            return res.json({ success: true, assignments });
        } catch (err) {
            return handleError(res, err, "GET TASK ASSIGNMENTS");
        }
    }
);

// POST /api/contributor/admin/tasks
router.post(
    "/tasks",
    requireContributorPermission("task.create"),
    async (req, res) => {
        try {
            const task = await taskService.createTask(
                {
                    ...req.body,
                    createdByUserId: req.user.id
                },
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                task
            });
        } catch (err) {
            return handleError(res, err, "CREATE TASK");
        }
    }
);

// PUT /api/contributor/admin/tasks/:id
router.put(
    "/tasks/:id",
    requireContributorPermission("task.edit"),
    async (req, res) => {
        try {
            const task = await taskService.updateTask(
                req.params.id,
                req.user.id,
                req.body,
                getAuditInfo(req)
            );

            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "UPDATE TASK");
        }
    }
);

// POST /api/contributor/admin/tasks/:id/publish
router.post(
    "/tasks/:id/publish",
    requireContributorPermission("task.publish"),
    async (req, res) => {
        try {
            const task = await taskService.publishTask(
                req.params.id,
                req.user.id,
                getAuditInfo(req)
            );

            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "PUBLISH TASK");
        }
    }
);

// POST /api/contributor/admin/tasks/:id/pause
router.post(
    "/tasks/:id/pause",
    requireContributorPermission("task.edit"),
    async (req, res) => {
        try {
            const task = await taskService.pauseTask(
                req.params.id,
                req.user.id,
                getAuditInfo(req)
            );

            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "PAUSE TASK");
        }
    }
);

// POST /api/contributor/admin/tasks/:id/resume
router.post(
    "/tasks/:id/resume",
    requireContributorPermission("task.publish"),
    async (req, res) => {
        try {
            const task = await taskService.resumeTask(
                req.params.id,
                req.user.id,
                getAuditInfo(req)
            );

            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "RESUME TASK");
        }
    }
);

// POST /api/contributor/admin/tasks/:id/close
router.post(
    "/tasks/:id/close",
    requireContributorPermission("task.edit"),
    async (req, res) => {
        try {
            const task = await taskService.closeTask(
                req.params.id,
                req.user.id,
                getAuditInfo(req)
            );

            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "CLOSE TASK");
        }
    }
);

// ADMIN: GET SUBMISSIONS
router.get(
    "/submissions",
    requireContributorPermission("submission.review"),
    async (req, res) => {
        try {
            const result = await taskService.getAdminSubmissions(req.query);
            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET ADMIN SUBMISSIONS");
        }
    }
);

module.exports = router;
