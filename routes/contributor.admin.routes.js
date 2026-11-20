
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const rbacService = require("../services/contributor.rbac.admin.service");
const taskService = require("../services/contributor.task.service");
const memberService = require("../services/contributor.member.admin.service");
const auditService = require("../services/contributor.audit.admin.service");
const referralAdminService = require("../services/rewards.referral.admin.service");
router.use((req, res, next) => {
    console.log("[ADMIN ROUTER ENTER]", req.method, req.originalUrl);
    next();
});

router.use(auth);


function handleError(res, err, label = "ADMIN") {
    console.error(`[CONTRIBUTOR ${label}]`, err);

    const errors = {
        // 400 – Bad Request
        INVALID_USER_ID: 400,
        INVALID_ROLE_KEY: 400,
        INVALID_PERMISSION_KEY: 400,
        INVALID_EFFECT: 400,
        INVALID_TASK_ID: 400,
        INVALID_ASSIGNMENT_ID: 400,
        INVALID_TITLE: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_CATEGORY: 400,
        INVALID_REWARD: 400,
        INVALID_MAX_PARTICIPANTS: 400,
        INVALID_DEADLINE: 400,
        INVALID_INSTRUCTIONS: 400,
        INVALID_DATA: 400,
        INVALID_TASK_STATUS: 400,
        INVALID_SUBMISSION_ID: 400,
        INVALID_PAGE: 400,
        INVALID_LIMIT: 400,
        INVALID_DATE_RANGE: 400,
        SUBMISSION_CONTENT_REQUIRED: 400,
        INVALID_ATTACHMENTS: 400,
        INVALID_ATTACHMENT_URL: 400,
        INVALID_REVIEWER_ID: 400,
        INVALID_REVIEW_DECISION: 400,
        INVALID_FEEDBACK: 400,

        // 403 – Forbidden
        SELF_REVIEW_NOT_ALLOWED: 403,
        

        // 404 – Not Found
        TARGET_USER_NOT_FOUND: 404,
        ROLE_NOT_FOUND: 404,
        PERMISSION_NOT_FOUND: 404,
        TASK_NOT_FOUND: 404,
        ASSIGNMENT_NOT_FOUND: 404,
        SUBMISSION_NOT_FOUND: 404,

        // 409 – Conflict
        TASK_CANNOT_BE_PUBLISHED: 409,
        TASK_CANNOT_BE_PAUSED: 409,
        TASK_CANNOT_BE_RESUMED: 409,
        TASK_CANNOT_BE_CLOSED: 409,
        TASK_CANNOT_BE_EDITED: 409,
        TASK_INVALID_STATUS: 409,
        TASK_DEADLINE_PASSED: 409,
        TASK_CLOSED: 409,
        MAX_PARTICIPANTS_BELOW_CURRENT: 409,
        ASSIGNMENT_NOT_SUBMITTABLE: 409,
        REVISION_NOT_REQUESTED: 409,
        ASSIGNMENT_NOT_REVIEWABLE: 409,
        SUBMISSION_ALREADY_REVIEWED: 409,
        REWARD_ALREADY_GRANTED: 409,
        INVALID_REFERRAL_ID: 400,
        INVALID_REFERRAL_STATUS: 400,
        REFERRAL_NOT_FOUND: 404,
        INVALID_REFERRAL_CODE_ID: 400,
        INVALID_REFERRAL_CODE_STATUS: 400,
        REFERRAL_CODE_NOT_FOUND: 404,
        REFERRAL_CODE_STATUS_UNCHANGED: 409,
    };

    const status = errors[err.message] || 500;

    return res.status(status).json({
        success: false,
        error: status === 500
           ? "CONTRIBUTOR_OPERATION_FAILED"
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

// =========================
// MEMBER MANAGEMENT
// =========================

// GET /api/contributor/admin/members
router.get(
    "/members",
    requireContributorPermission("contributor.manage"),
    async (req, res) => {
        try {
            const result = await memberService.getMembers(req.query);
            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET MEMBERS");
        }
    }
);

// GET /api/contributor/admin/members/:userId
router.get(
    "/members/:userId",
    requireContributorPermission("contributor.manage"),
    async (req, res) => {
        try {
            const result = await memberService.getMemberDetail(
                req.params.userId
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET MEMBER DETAIL");
        }
    }
);

// GET /api/contributor/admin/members/:userId/activity
router.get(
    "/members/:userId/activity",
    requireContributorPermission("contributor.manage"),
    async (req, res) => {
        try {
            const result = await memberService.getMemberActivity(
                req.params.userId,
                req.query
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET MEMBER ACTIVITY");
        }
    }
);

// GET /api/contributor/admin/members/:userId/transactions
router.get(
    "/members/:userId/transactions",
    requireContributorPermission("contributor.manage"),
    async (req, res) => {
        try {
            const result = await memberService.getMemberTransactions(
                req.params.userId,
                req.query
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET MEMBER TRANSACTIONS");
        }
    }
);


// =========================
// AUDIT LOGS
// =========================

// GET /api/contributor/admin/audit-logs
router.get(
    "/audit-logs",
    requireContributorPermission("audit.view"),
    async (req, res) => {
        try {
            const result = await auditService.getAuditLogs(req.query);

            return res.json({
                success: true,
                ...result
            });
        } catch (err) {
            return handleError(res, err, "GET AUDIT LOGS");
        }
    }
);


// =========================
// REFERRAL MANAGEMENT
// =========================

// GET /api/contributor/admin/referrals/summary
router.get(
    "/referrals/summary",
    requireContributorPermission("referral.view"),
    async (req, res) => {
        try {
            const summary = await referralAdminService.getSummary();
            return res.json({ success: true, summary });
        } catch (err) {
            return handleError(res, err, "GET REFERRAL SUMMARY");
        }
    }
);

// GET /api/contributor/admin/referrals
router.get(
    "/referrals",
    requireContributorPermission("referral.view"),
    async (req, res) => {
        try {
            const result = await referralAdminService.getReferrals(req.query);
            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET REFERRALS");
        }
    }
);

// GET /api/contributor/admin/referrals/:id
router.get(
    "/referrals/:id",
    requireContributorPermission("referral.view"),
    async (req, res) => {
        try {
            const result = await referralAdminService.getReferralDetail(
                req.params.id
            );
            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "GET REFERRAL DETAIL");
        }
    }
);


async function handleReferralCodeStatus(req, res, status) {
    try {
        const result = await referralAdminService.changeReferralCodeStatus(
            req.params.id,
            req.user.id,
            status,
            getAuditInfo(req)
        );

        return res.json({ success: true, referralCode: result });
    } catch (err) {
        return handleError(res, err, "CHANGE REFERRAL CODE STATUS");
    }
}

// PUT /api/contributor/admin/referral-codes/:id/disable
router.put(
    "/referral-codes/:id/disable",
    requireContributorPermission("referral.manage"),
    (req, res) => handleReferralCodeStatus(req, res, "disabled")
);

// PUT /api/contributor/admin/referral-codes/:id/enable
router.put(
    "/referral-codes/:id/enable",
    requireContributorPermission("referral.manage"),
    (req, res) => handleReferralCodeStatus(req, res, "active")
);

module.exports = router;
