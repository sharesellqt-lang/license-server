
"use strict";

const db = require("../db");
const rewardsLedger = require("./rewards.ledger.service");
const { writeAudit } = require("./contributor.audit.service");

const MAX_CREDITS = BigInt("18446744073709551615");
const MAX_CONTENT_LENGTH = 100000;
const MAX_FEEDBACK_LENGTH = 10000;

function positiveId(value, error = "INVALID_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }
    return id;
}

function validateObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("INVALID_DATA");
    }
}

function validateReward(value) {
    const raw = String(value ?? "0").trim();

    if (!/^\d+$/.test(raw)) {
        throw new Error("INVALID_REWARD");
    }

    let reward;

    try {
        reward = BigInt(raw);
    } catch {
        throw new Error("INVALID_REWARD");
    }

    if (reward < 0n || reward > MAX_CREDITS) {
        throw new Error("INVALID_REWARD");
    }

    return reward.toString();
}

function validateTask(data) {
    validateObject(data);

    const title = String(data.title ?? "").trim();
    const description = String(data.description ?? "").trim();
    const category = String(data.category ?? "").trim();

    if (!title || title.length > 200) {
        throw new Error("INVALID_TITLE");
    }

    if (!description || description.length > MAX_CONTENT_LENGTH) {
        throw new Error("INVALID_DESCRIPTION");
    }

    if (!category || category.length > 50) {
        throw new Error("INVALID_CATEGORY");
    }

    const rewardCredits = validateReward(data.rewardCredits);

    const instructions = data.instructions == null
        ? null
        : String(data.instructions).trim();

    if (instructions && instructions.length > MAX_CONTENT_LENGTH) {
        throw new Error("INVALID_INSTRUCTIONS");
    }

    const maxParticipants = data.maxParticipants == null ||
        data.maxParticipants === ""
        ? null
        : Number(data.maxParticipants);

    if (
        maxParticipants !== null &&
        (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1)
    ) {
        throw new Error("INVALID_MAX_PARTICIPANTS");
    }

    const deadline = data.deadline || null;

    if (
        deadline !== null &&
        (
            typeof deadline !== "string" ||
            !Number.isFinite(Date.parse(deadline))
        )
    ) {
        throw new Error("INVALID_DEADLINE");
    }

    return {
        title,
        description,
        instructions,
        category,
        rewardCredits,
        maxParticipants,
        deadline
    };
}

function auditData(actorUserId, action, entityType, entityId, oldData, newData, audit = {}) {
    return {
        actorUserId,
        targetUserId: null,
        action,
        entityType,
        entityId: String(entityId),
        oldData,
        newData,
        ipAddress: audit.ipAddress || null,
        userAgent: audit.userAgent || null
    };
}

async function createTask(data, audit = {}) {
    validateObject(data);

    const creatorId = positiveId(
        data.createdByUserId,
        "INVALID_USER_ID"
    );

    const task = validateTask(data);
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(
            `INSERT INTO contributor_tasks (
                title, description, instructions, category,
                reward_credits, max_participants, deadline,
                status, created_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
            [
                task.title,
                task.description,
                task.instructions,
                task.category,
                task.rewardCredits,
                task.maxParticipants,
                task.deadline,
                creatorId
            ]
        );

        await writeAudit(conn, auditData(
            creatorId,
            "task.created",
            "contributor_task",
            result.insertId,
            null,
            { ...task, status: "draft" },
            audit
        ));

        await conn.commit();

        return {
            id: result.insertId,
            status: "draft"
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getTaskForUpdate(conn, taskId) {
    const [rows] = await conn.execute(
        `SELECT *
         FROM contributor_tasks
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [taskId]
    );

    if (!rows.length) {
        throw new Error("TASK_NOT_FOUND");
    }

    return rows[0];
}

async function changeTaskStatus(taskId, actorUserId, fromStatuses, newStatus, action, audit = {}) {
    const id = positiveId(taskId, "INVALID_TASK_ID");
    const actorId = positiveId(actorUserId, "INVALID_USER_ID");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const task = await getTaskForUpdate(conn, id);

        if (!fromStatuses.includes(task.status)) {
            throw new Error("TASK_INVALID_STATUS");
        }

        if (
            newStatus === "published" &&
            task.deadline &&
            new Date(task.deadline).getTime() <= Date.now()
        ) {
            throw new Error("TASK_DEADLINE_PASSED");
        }

        await conn.execute(
            `UPDATE contributor_tasks
             SET status = ?
             WHERE id = ?`,
            [newStatus, id]
        );

        await writeAudit(conn, auditData(
            actorId,
            action,
            "contributor_task",
            id,
            { status: task.status },
            { status: newStatus },
            audit
        ));

        await conn.commit();

        return { id, status: newStatus };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function publishTask(taskId, actorUserId, audit = {}) {
    return changeTaskStatus(
        taskId,
        actorUserId,
        ["draft", "paused"],
        "published",
        "task.published",
        audit
    );
}

async function pauseTask(taskId, actorUserId, audit = {}) {
    return changeTaskStatus(
        taskId,
        actorUserId,
        ["published"],
        "paused",
        "task.paused",
        audit
    );
}

async function resumeTask(taskId, actorUserId, audit = {}) {
    return changeTaskStatus(
        taskId,
        actorUserId,
        ["paused"],
        "published",
        "task.resumed",
        audit
    );
}

async function closeTask(taskId, actorUserId, audit = {}) {
    return changeTaskStatus(
        taskId,
        actorUserId,
        ["draft", "published", "paused"],
        "closed",
        "task.closed",
        audit
    );
}

async function updateTask(taskId, actorUserId, data, audit = {}) {
    const id = positiveId(taskId, "INVALID_TASK_ID");
    const actorId = positiveId(actorUserId, "INVALID_USER_ID");

    validateObject(data);

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const oldTask = await getTaskForUpdate(conn, id);

        if (!["draft", "paused"].includes(oldTask.status)) {
            throw new Error("TASK_CANNOT_BE_EDITED");
        }

        const task = validateTask({
            title: data.title ?? oldTask.title,
            description: data.description ?? oldTask.description,
            instructions: data.instructions === undefined
                ? oldTask.instructions
                : data.instructions,
            category: data.category ?? oldTask.category,
            rewardCredits: data.rewardCredits ?? oldTask.reward_credits,
            maxParticipants: data.maxParticipants === undefined
                ? oldTask.max_participants
                : data.maxParticipants,
            deadline: data.deadline === undefined
                ? oldTask.deadline
                : data.deadline
        });

        if (task.maxParticipants !== null) {
            const [[count]] = await conn.execute(
                `SELECT COUNT(*) AS total
                 FROM contributor_task_assignments
                 WHERE task_id = ?
                   AND status <> 'cancelled'`,
                [id]
            );

            if (Number(count.total) > task.maxParticipants) {
                throw new Error("MAX_PARTICIPANTS_BELOW_CURRENT");
            }
        }

        await conn.execute(
            `UPDATE contributor_tasks
             SET title = ?,
                 description = ?,
                 instructions = ?,
                 category = ?,
                 reward_credits = ?,
                 max_participants = ?,
                 deadline = ?
             WHERE id = ?`,
            [
                task.title,
                task.description,
                task.instructions,
                task.category,
                task.rewardCredits,
                task.maxParticipants,
                task.deadline,
                id
            ]
        );

        await writeAudit(conn, auditData(
            actorId,
            "task.updated",
            "contributor_task",
            id,
            oldTask,
            task,
            audit
        ));

        await conn.commit();

        return { id, status: oldTask.status, ...task };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getTasks(page = 1, limit = 20) {
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const offset = (page - 1) * limit;

    const where = `
        t.status = 'published'
        AND (t.deadline IS NULL OR t.deadline > NOW())
        AND (
            t.max_participants IS NULL
            OR (
                SELECT COUNT(*)
                FROM contributor_task_assignments ca
                WHERE ca.task_id = t.id
                  AND ca.status <> 'cancelled'
            ) < t.max_participants
        )
    `;

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_tasks t
         WHERE ${where}`
    );

    const [rows] = await db.execute(
        `SELECT t.id, t.title, t.description, t.instructions,
                t.category, t.reward_credits, t.max_participants,
                t.deadline, t.created_at,
                (
                    SELECT COUNT(*)
                    FROM contributor_task_assignments a
                    WHERE a.task_id = t.id
                      AND a.status <> 'cancelled'
                ) AS participant_count
         FROM contributor_tasks t
         WHERE ${where}
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );

    const total = Number(count.total);

    return {
        tasks: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getAdminTasks(page = 1, limit = 20, status = null) {
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const allowedStatuses = ["draft", "published", "paused", "closed"];

    if (status && !allowedStatuses.includes(status)) {
        throw new Error("INVALID_TASK_STATUS");
    }

    const offset = (page - 1) * limit;
    const params = status ? [status] : [];

    const condition = status ? "WHERE t.status = ?" : "";

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_tasks t
         ${condition}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT t.*,
                (
                    SELECT COUNT(*)
                    FROM contributor_task_assignments a
                    WHERE a.task_id = t.id
                      AND a.status <> 'cancelled'
                ) AS participant_count,
                (
                    SELECT COUNT(*)
                    FROM contributor_submissions s
                    JOIN contributor_task_assignments a
                      ON a.id = s.assignment_id
                    WHERE a.task_id = t.id
                ) AS submission_count
         FROM contributor_tasks t
         ${condition}
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const total = Number(count.total);

    return {
        tasks: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function getTaskById(taskId) {
    const id = positiveId(taskId, "INVALID_TASK_ID");

    const [rows] = await db.execute(
        `SELECT t.*,
                (
                    SELECT COUNT(*)
                    FROM contributor_task_assignments a
                    WHERE a.task_id = t.id
                      AND a.status <> 'cancelled'
                ) AS participant_count
         FROM contributor_tasks t
         WHERE t.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) {
        throw new Error("TASK_NOT_FOUND");
    }

    return rows[0];
}

async function getTaskAssignments(taskId, page = 1, limit = 20) {
    const id = positiveId(taskId, "INVALID_TASK_ID");

    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const offset = (page - 1) * limit;

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_task_assignments
         WHERE task_id = ?`,
        [id]
    );

    const [rows] = await db.execute(
        `SELECT a.id AS assignment_id, a.user_id, a.status,
                a.accepted_at, a.completed_at,
                a.cancelled_at, a.cancelled_by_user_id,
                a.cancel_reason,
                (
                    SELECT s.id
                    FROM contributor_submissions s
                    WHERE s.assignment_id = a.id
                    ORDER BY s.attempt_no DESC
                    LIMIT 1
                ) AS latest_submission_id,
                (
                    SELECT s.status
                    FROM contributor_submissions s
                    WHERE s.assignment_id = a.id
                    ORDER BY s.attempt_no DESC
                    LIMIT 1
                ) AS latest_submission_status
         FROM contributor_task_assignments a
         WHERE a.task_id = ?
         ORDER BY a.id DESC
         LIMIT ? OFFSET ?`,
        [id, limit, offset]
    );

    const total = Number(count.total);

    return {
        assignments: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function acceptTask(userId, taskId) {
    userId = positiveId(userId, "INVALID_USER_ID");
    taskId = positiveId(taskId, "INVALID_TASK_ID");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [tasks] = await conn.execute(
            `SELECT id, status, max_participants, deadline
             FROM contributor_tasks
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [taskId]
        );

        if (!tasks.length) {
            throw new Error("TASK_NOT_FOUND");
        }

        const task = tasks[0];

        if (task.status !== "published") {
            throw new Error("TASK_NOT_AVAILABLE");
        }

        const [[deadlineCheck]] = await conn.execute(
            `SELECT
                (? IS NOT NULL AND ? <= NOW()) AS expired`,
            [task.deadline, task.deadline]
        );

        if (Number(deadlineCheck.expired)) {
            throw new Error("TASK_DEADLINE_PASSED");
        }

        const [existing] = await conn.execute(
            `SELECT id, status
             FROM contributor_task_assignments
             WHERE task_id = ? AND user_id = ?
             LIMIT 1`,
            [taskId, userId]
        );

        if (existing.length) {
            throw new Error("TASK_ALREADY_ACCEPTED");
        }

        if (task.max_participants !== null) {
            const [[count]] = await conn.execute(
                `SELECT COUNT(*) AS total
                 FROM contributor_task_assignments
                 WHERE task_id = ?
                   AND status <> 'cancelled'`,
                [taskId]
            );

            if (Number(count.total) >= Number(task.max_participants)) {
                throw new Error("TASK_FULL");
            }
        }

        const [result] = await conn.execute(
            `INSERT INTO contributor_task_assignments
             (task_id, user_id, status)
             VALUES (?, ?, 'accepted')`,
            [taskId, userId]
        );

        await writeAudit(conn, auditData(
            userId,
            "assignment.accepted",
            "contributor_assignment",
            result.insertId,
            null,
            { taskId, status: "accepted" }
        ));

        await conn.commit();

        return {
            assignmentId: result.insertId,
            taskId,
            status: "accepted"
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function cancelAssignment(userId, assignmentId, reason = null, audit = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");
    assignmentId = positiveId(assignmentId, "INVALID_ASSIGNMENT_ID");

    if (reason != null && typeof reason !== "string") {
        throw new Error("INVALID_CANCEL_REASON");
    }

    reason = reason == null ? null : reason.trim();

    if (reason && reason.length > 500) {
        throw new Error("INVALID_CANCEL_REASON");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT id, task_id, user_id, status
             FROM contributor_task_assignments
             WHERE id = ? AND user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [assignmentId, userId]
        );

        if (!rows.length) {
            throw new Error("ASSIGNMENT_NOT_FOUND");
        }

        const assignment = rows[0];

        if (assignment.status !== "accepted") {
            throw new Error("ASSIGNMENT_CANNOT_BE_CANCELLED");
        }

        await conn.execute(
            `UPDATE contributor_task_assignments
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by_user_id = ?,
                 cancel_reason = ?
             WHERE id = ?`,
            [userId, reason, assignmentId]
        );

        await writeAudit(conn, auditData(
            userId,
            "assignment.cancelled",
            "contributor_assignment",
            assignmentId,
            { status: assignment.status },
            { status: "cancelled", reason },
            audit
        ));

        await conn.commit();

        return {
            assignmentId,
            status: "cancelled"
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function submitWork(userId, assignmentId, data, audit = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");
    assignmentId = positiveId(assignmentId, "INVALID_ASSIGNMENT_ID");

    validateObject(data);

    const content = String(data.content ?? "").trim();

    if (!content || content.length > MAX_CONTENT_LENGTH) {
        throw new Error("SUBMISSION_CONTENT_REQUIRED");
    }

    let attachments = data.attachmentUrls ?? [];

    if (!Array.isArray(attachments) || attachments.length > 20) {
        throw new Error("INVALID_ATTACHMENTS");
    }

    attachments = attachments.map(url => {
        if (typeof url !== "string" || url.length > 2048) {
            throw new Error("INVALID_ATTACHMENT_URL");
        }

        let parsed;

        try {
            parsed = new URL(url);
        } catch {
            throw new Error("INVALID_ATTACHMENT_URL");
        }

        if (!["https:", "http:"].includes(parsed.protocol)) {
            throw new Error("INVALID_ATTACHMENT_URL");
        }

        return url;
    });

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [assignments] = await conn.execute(
            `SELECT a.id, a.task_id, a.status,
                    t.status AS task_status, t.deadline
             FROM contributor_task_assignments a
             JOIN contributor_tasks t ON t.id = a.task_id
             WHERE a.id = ? AND a.user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [assignmentId, userId]
        );

        if (!assignments.length) {
            throw new Error("ASSIGNMENT_NOT_FOUND");
        }

        const assignment = assignments[0];

        if (assignment.task_status === "closed") {
            throw new Error("TASK_CLOSED");
        }

        const [[deadlineCheck]] = await conn.execute(
            `SELECT
                (? IS NOT NULL AND ? <= NOW()) AS expired`,
            [assignment.deadline, assignment.deadline]
        );

        if (Number(deadlineCheck.expired)) {
            throw new Error("TASK_DEADLINE_PASSED");
        }

        if (!["accepted", "submitted"].includes(assignment.status)) {
            throw new Error("ASSIGNMENT_NOT_SUBMITTABLE");
        }

        const [previous] = await conn.execute(
            `SELECT id, attempt_no, status
             FROM contributor_submissions
             WHERE assignment_id = ?
             ORDER BY attempt_no DESC
             LIMIT 1
             FOR UPDATE`,
            [assignmentId]
        );

        let attemptNo = 1;

        if (previous.length) {
            if (previous[0].status !== "revision_requested") {
                throw new Error("REVISION_NOT_REQUESTED");
            }

            attemptNo = Number(previous[0].attempt_no) + 1;
        }

        const [result] = await conn.execute(
            `INSERT INTO contributor_submissions (
                assignment_id, attempt_no, content, attachment_urls
            ) VALUES (?, ?, ?, ?)`,
            [
                assignmentId,
                attemptNo,
                content,
                JSON.stringify(attachments)
            ]
        );

        await conn.execute(
            `UPDATE contributor_task_assignments
             SET status = 'submitted'
             WHERE id = ?`,
            [assignmentId]
        );

        await writeAudit(conn, auditData(
            userId,
            "submission.created",
            "contributor_submission",
            result.insertId,
            null,
            {
                assignmentId,
                attemptNo,
                status: "submitted"
            },
            audit
        ));

        await conn.commit();

        return {
            submissionId: result.insertId,
            assignmentId,
            attemptNo,
            status: "submitted"
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getMyAssignments(userId) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const [rows] = await db.execute(
        `SELECT a.id AS assignment_id, a.task_id, a.status,
                a.accepted_at, a.completed_at,
                a.cancelled_at, a.cancel_reason,
                t.title, t.description, t.category,
                t.reward_credits, t.deadline, t.status AS task_status,
                (
                    SELECT s.id
                    FROM contributor_submissions s
                    WHERE s.assignment_id = a.id
                    ORDER BY s.attempt_no DESC
                    LIMIT 1
                ) AS latest_submission_id,
                (
                    SELECT s.attempt_no
                    FROM contributor_submissions s
                    WHERE s.assignment_id = a.id
                    ORDER BY s.attempt_no DESC
                    LIMIT 1
                ) AS latest_attempt_no,
                (
                    SELECT s.status
                    FROM contributor_submissions s
                    WHERE s.assignment_id = a.id
                    ORDER BY s.attempt_no DESC
                    LIMIT 1
                ) AS latest_submission_status
         FROM contributor_task_assignments a
         JOIN contributor_tasks t ON t.id = a.task_id
         WHERE a.user_id = ?
         ORDER BY a.id DESC`,
        [userId]
    );

    return rows;
}

async function getMySubmissions(userId) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const [rows] = await db.execute(
        `SELECT s.id, s.assignment_id, s.attempt_no,
                s.content, s.attachment_urls, s.status,
                s.submitted_at, s.reviewed_at,
                t.title AS task_title,
                (
                    SELECT r.feedback
                    FROM contributor_reviews r
                    WHERE r.submission_id = s.id
                    ORDER BY r.id DESC
                    LIMIT 1
                ) AS feedback,
                (
                    SELECT r.decision
                    FROM contributor_reviews r
                    WHERE r.submission_id = s.id
                    ORDER BY r.id DESC
                    LIMIT 1
                ) AS review_decision
         FROM contributor_submissions s
         JOIN contributor_task_assignments a
            ON a.id = s.assignment_id
         JOIN contributor_tasks t ON t.id = a.task_id
         WHERE a.user_id = ?
         ORDER BY s.id DESC`,
        [userId]
    );

    return rows.map(row => {
        let attachmentUrls = [];

        try {
            attachmentUrls = row.attachment_urls
                ? JSON.parse(row.attachment_urls)
                : [];
        } catch {
            attachmentUrls = [];
        }

        return {
            ...row,
            attachment_urls: attachmentUrls
        };
    });
}

async function reviewSubmission(reviewerId, submissionId, data = {}, audit = {}) {
    reviewerId = positiveId(reviewerId, "INVALID_REVIEWER_ID");
    submissionId = positiveId(submissionId, "INVALID_SUBMISSION_ID");

    validateObject(data);

    const decision = String(data.decision ?? "").trim();

    const feedback = data.feedback == null
        ? null
        : String(data.feedback).trim();

    if (!["approved", "rejected", "revision_requested"].includes(decision)) {
        throw new Error("INVALID_REVIEW_DECISION");
    }

    if (feedback && feedback.length > MAX_FEEDBACK_LENGTH) {
        throw new Error("INVALID_FEEDBACK");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT
                s.id,
                s.assignment_id,
                s.attempt_no,
                s.status AS submission_status,
                s.reward_transaction_id,
                a.user_id AS contributor_user_id,
                a.status AS assignment_status,
                a.task_id,
                t.title AS task_title,
                t.reward_credits
             FROM contributor_submissions s
             JOIN contributor_task_assignments a
                ON a.id = s.assignment_id
             JOIN contributor_tasks t
                ON t.id = a.task_id
             WHERE s.id = ?
             LIMIT 1
             FOR UPDATE`,
            [submissionId]
        );

        if (!rows.length) {
            throw new Error("SUBMISSION_NOT_FOUND");
        }

        const submission = rows[0];

        if (Number(submission.contributor_user_id) === reviewerId) {
            throw new Error("SELF_REVIEW_NOT_ALLOWED");
        }

        if (submission.submission_status !== "submitted") {
            throw new Error("SUBMISSION_ALREADY_REVIEWED");
        }

        if (submission.assignment_status !== "submitted") {
            throw new Error("ASSIGNMENT_NOT_REVIEWABLE");
        }

        if (submission.reward_transaction_id != null) {
            throw new Error("REWARD_ALREADY_GRANTED");
        }

        const [reviewResult] = await conn.execute(
            `INSERT INTO contributor_reviews (
                submission_id,
                reviewer_user_id,
                decision,
                feedback
            ) VALUES (?, ?, ?, ?)`,
            [submissionId, reviewerId, decision, feedback]
        );

        let rewardResult = null;
        let rewardCredits = "0";

        if (decision === "approved") {
            const credits = BigInt(
                validateReward(submission.reward_credits)
            );

            if (credits > 0n) {
                rewardResult = await rewardsLedger.creditWalletWithConnection(
                    conn,
                    {
                        userId: Number(submission.contributor_user_id),
                        amount: credits.toString(),
                        source: "contributor_task",
                        idempotencyKey: `contributor_submission:${submissionId}:approved`,
                        referenceType: "contributor_submission",
                        referenceId: String(submissionId),
                        description: `Hoàn thành nhiệm vụ: ${submission.task_title}`,
                        metadata: {
                            submissionId,
                            assignmentId: Number(submission.assignment_id),
                            taskId: Number(submission.task_id),
                            reviewerId
                        }
                    }
                );

                rewardCredits = credits.toString();
            }

            await conn.execute(
                `UPDATE contributor_task_assignments
                 SET status = 'completed',
                     completed_at = NOW()
                 WHERE id = ?`,
                [submission.assignment_id]
            );
        }

        if (decision === "rejected") {
            await conn.execute(
                `UPDATE contributor_task_assignments
                 SET status = 'rejected'
                 WHERE id = ?`,
                [submission.assignment_id]
            );
        }

        // revision_requested: Assignment vẫn submitted
        // để Contributor có thể nộp attempt tiếp theo.

        await conn.execute(
            `UPDATE contributor_submissions
             SET status = ?,
                 reviewed_at = NOW(),
                 reward_transaction_id = ?
             WHERE id = ?`,
            [
                decision,
                rewardResult ? rewardResult.transactionId : null,
                submissionId
            ]
        );

        await writeAudit(conn, auditData(
            reviewerId,
            "submission.reviewed",
            "contributor_submission",
            submissionId,
            {
                status: submission.submission_status,
                assignmentStatus: submission.assignment_status
            },
            {
                decision,
                feedback,
                rewardCredits,
                rewardTransactionId: rewardResult
                    ? rewardResult.transactionId
                    : null,
                assignmentStatus: decision === "approved"
                    ? "completed"
                    : decision === "rejected"
                        ? "rejected"
                        : "submitted"
            },
            audit
        ));

        await conn.commit();

        return {
            success: true,
            submissionId,
            reviewId: reviewResult.insertId,
            decision,
            reward: {
                credits: rewardCredits,
                transactionId: rewardResult
                    ? rewardResult.transactionId
                    : null
            }
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    createTask,
    updateTask,
    publishTask,
    pauseTask,
    resumeTask,
    closeTask,
    getTasks,
    getAdminTasks,
    getTaskById,
    getTaskAssignments,
    acceptTask,
    cancelAssignment,
    submitWork,
    getMyAssignments,
    getMySubmissions,
    reviewSubmission
};
