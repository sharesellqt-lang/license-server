
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const taskService = require("../services/contributor.task.service");
const referralService = require("../services/rewards.referral.service");
const referralService = require("../services/contributor.referral.service");

function handleError(res, err, label) {
    console.error(`[CONTRIBUTOR ${label}]`, err);

    const errors = {
        INVALID_USER_ID: 400,
        INVALID_TASK_ID: 400,
        INVALID_ASSIGNMENT_ID: 400,
        INVALID_REVIEWER_ID: 400,
        INVALID_SUBMISSION_ID: 400,
        INVALID_REVIEW_DECISION: 400,
        INVALID_REWARD: 400,
        INVALID_DATA: 400,
        INVALID_ATTACHMENTS: 400,
        INVALID_ATTACHMENT_URL: 400,
        INVALID_CANCEL_REASON: 400,
        INVALID_FEEDBACK: 400,
        SUBMISSION_CONTENT_REQUIRED: 400,

        TASK_NOT_FOUND: 404,
        ASSIGNMENT_NOT_FOUND: 404,
        SUBMISSION_NOT_FOUND: 404,

        TASK_NOT_AVAILABLE: 409,
        TASK_DEADLINE_PASSED: 409,
        TASK_ALREADY_ACCEPTED: 409,
        TASK_FULL: 409,
        TASK_CLOSED: 409,
        ASSIGNMENT_NOT_SUBMITTABLE: 409,
        ASSIGNMENT_CANNOT_BE_CANCELLED: 409,
        REVISION_NOT_REQUESTED: 409,
        SUBMISSION_ALREADY_REVIEWED: 409,
        REWARD_ALREADY_GRANTED: 409,
        ASSIGNMENT_NOT_REVIEWABLE: 409,

        SELF_REVIEW_NOT_ALLOWED: 403
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

// GET /api/contributor/me/access
router.get(
    "/me/access",
    auth,
    async (req, res) => {
        try {
            const access = await require("../services/contributor.rbac.admin.service")
                .getUserAccess(req.user.id);

            return res.json({
                success: true,
                access
            });
        } catch (err) {
            return handleError(res, err, "MY ACCESS");
        }
    }
);
// GET /api/contributor/tasks
router.get(
    "/tasks",
    auth,
    requireContributorPermission("task.view"),
    async (req, res) => {
        try {
            const result = await taskService.getTasks(
                req.query.page,
                req.query.limit
            );

            return res.json({ success: true, ...result });
        } catch (err) {
            return handleError(res, err, "TASK LIST");
        }
    }
);

// GET /api/contributor/tasks/:id
router.get(
    "/tasks/:id",
    auth,
    requireContributorPermission("task.view"),
    async (req, res) => {
        try {
            const task = await taskService.getTaskById(req.params.id);
            return res.json({ success: true, task });
        } catch (err) {
            return handleError(res, err, "TASK DETAIL");
        }
    }
);

// POST /api/contributor/tasks/:id/accept
router.post(
    "/tasks/:id/accept",
    auth,
    requireContributorPermission("task.accept"),
    async (req, res) => {
        try {
            const result = await taskService.acceptTask(
                req.user.id,
                req.params.id,
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                assignment: result
            });
        } catch (err) {
            return handleError(res, err, "ACCEPT TASK");
        }
    }
);

// POST /api/contributor/assignments/:id/cancel
router.post(
    "/assignments/:id/cancel",
    auth,
    requireContributorPermission("task.accept"),
    async (req, res) => {
        try {
            const result = await taskService.cancelAssignment(
                req.user.id,
                req.params.id,
                req.body?.reason,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                assignment: result
            });
        } catch (err) {
            return handleError(res, err, "CANCEL ASSIGNMENT");
        }
    }
);

// POST /api/contributor/assignments/:id/submit
router.post(
    "/assignments/:id/submit",
    auth,
    requireContributorPermission("submission.create"),
    async (req, res) => {
        try {
            const result = await taskService.submitWork(
                req.user.id,
                req.params.id,
                req.body,
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                submission: result
            });
        } catch (err) {
            return handleError(res, err, "SUBMIT WORK");
        }
    }
);

// POST /api/contributor/submissions/:id/review
router.post(
    "/submissions/:id/review",
    auth,
    requireContributorPermission("submission.review"),
    async (req, res) => {
        try {
            const result = await taskService.reviewSubmission(
                req.user.id,
                req.params.id,
                req.body,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                review: result
            });
        } catch (err) {
            return handleError(res, err, "REVIEW SUBMISSION");
        }
    }
);

// GET /api/contributor/my-assignments
router.get(
    "/my-assignments",
    auth,
    requireContributorPermission("task.view"),
    async (req, res) => {
        try {
            const assignments = await taskService.getMyAssignments(
                req.user.id
            );

            return res.json({
                success: true,
                assignments
            });
        } catch (err) {
            return handleError(res, err, "MY ASSIGNMENTS");
        }
    }
);

// GET /api/contributor/my-submissions
router.get(
    "/my-submissions",
    auth,
    requireContributorPermission("submission.view"),
    async (req, res) => {
        try {
            const submissions = await taskService.getMySubmissions(
                req.user.id
            );

            return res.json({
                success: true,
                submissions
            });
        } catch (err) {
            return handleError(res, err, "MY SUBMISSIONS");
        }
    }
);

// GET /api/contributor/my-referral
router.get(
    "/my-referral",
    auth,
    async (req, res) => {
        try {
            const referral = await referralService.getMyReferral(
                req.user.id
            );

            return res.json({
                success: true,
                referral
            });
        } catch (err) {
            return handleError(res, err, "MY REFERRAL");
        }
    }
);

router.get("/my-referral", auth, async (req, res) => {
    try {
        const referral = await referralService.getMyReferral(req.user.id);

        return res.json({
            success: true,
            referral
        });
    } catch (error) {
        return handleError(res, error, "GET /my-referral");
    }
});
module.exports = router;
