
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const taskService = require("../services/contributor.task.service");

function handleError(res, err, label) {
    console.error(`[CONTRIBUTOR ${label}]`, err);

    const errors = {
        INVALID_USER_ID: 400,
        INVALID_TASK_ID: 400,
        INVALID_ASSIGNMENT_ID: 400,
        SUBMISSION_CONTENT_REQUIRED: 400,
        INVALID_ATTACHMENTS: 400,
        INVALID_ATTACHMENT_URL: 400,
        TASK_NOT_FOUND: 404,
        ASSIGNMENT_NOT_FOUND: 404,
        TASK_NOT_AVAILABLE: 409,
        TASK_DEADLINE_PASSED: 409,
        TASK_ALREADY_ACCEPTED: 409,
        TASK_FULL: 409,
        TASK_CLOSED: 409,
        ASSIGNMENT_NOT_SUBMITTABLE: 409,
        REVISION_NOT_REQUESTED: 409
    };

    const status = errors[err.message] || 500;

    return res.status(status).json({
        success: false,
        error: status === 500 ? "CONTRIBUTOR_OPERATION_FAILED" : err.message
    });
}

// GET /api/contributor/tasks
router.get("/tasks", auth, async (req, res) => {
    try {
        const result = await taskService.getTasks(
            req.query.page,
            req.query.limit
        );

        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(res, err, "TASK LIST");
    }
});

// POST /api/contributor/tasks/:id/accept
router.post("/tasks/:id/accept", auth, async (req, res) => {
    try {
        const result = await taskService.acceptTask(
            req.user.id,
            req.params.id
        );

        return res.status(201).json({
            success: true,
            assignment: result
        });
    } catch (err) {
        return handleError(res, err, "ACCEPT TASK");
    }
});

// POST /api/contributor/assignments/:id/submit
router.post("/assignments/:id/submit", auth, async (req, res) => {
    try {
        const result = await taskService.submitWork(
            req.user.id,
            req.params.id,
            req.body
        );

        return res.status(201).json({
            success: true,
            submission: result
        });
    } catch (err) {
        return handleError(res, err, "SUBMIT WORK");
    }
});

// GET /api/contributor/my-assignments
router.get("/my-assignments", auth, async (req, res) => {
    try {
        const assignments = await taskService.getMyAssignments(req.user.id);

        return res.json({
            success: true,
            assignments
        });
    } catch (err) {
        return handleError(res, err, "MY ASSIGNMENTS");
    }
});

// GET /api/contributor/my-submissions
router.get("/my-submissions", auth, async (req, res) => {
    try {
        const submissions = await taskService.getMySubmissions(req.user.id);

        return res.json({
            success: true,
            submissions
        });
    } catch (err) {
        return handleError(res, err, "MY SUBMISSIONS");
    }
});

module.exports = router;
