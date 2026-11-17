
"use strict";

const db = require("../db");

const rewardsLedger = require("./rewards.ledger.service");

const MAX_CREDITS = BigInt("18446744073709551615");

function positiveId(value, error = "INVALID_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(error);
    return id;
}

function validateTask(data) {
    const title = String(data.title || "").trim();
    const description = String(data.description || "").trim();
    const category = String(data.category || "").trim();
    const reward = BigInt(data.rewardCredits ?? 0);

    if (!title || title.length > 200) throw new Error("INVALID_TITLE");
    if (!description) throw new Error("INVALID_DESCRIPTION");
    if (!category || category.length > 50) throw new Error("INVALID_CATEGORY");
    if (reward < 0n || reward > MAX_CREDITS) throw new Error("INVALID_REWARD");

    const maxParticipants = data.maxParticipants == null
        ? null
        : Number(data.maxParticipants);

    if (
        maxParticipants !== null &&
        (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1)
    ) {
        throw new Error("INVALID_MAX_PARTICIPANTS");
    }

    const deadline = data.deadline || null;
    if (deadline && !Number.isFinite(Date.parse(deadline))) {
        throw new Error("INVALID_DEADLINE");
    }

    return {
        title,
        description,
        instructions: data.instructions ? String(data.instructions) : null,
        category,
        rewardCredits: reward.toString(),
        maxParticipants,
        deadline
    };
}

async function createTask(data) {
    const creatorId = positiveId(data.createdByUserId, "INVALID_CREATOR_ID");
    const task = validateTask(data);

    const [result] = await db.execute(
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

    return { id: result.insertId, status: "draft" };
}

async function publishTask(taskId) {
    const id = positiveId(taskId, "INVALID_TASK_ID");

    const [result] = await db.execute(
        `UPDATE contributor_tasks
         SET status = 'published'
         WHERE id = ?
           AND status IN ('draft', 'paused')
           AND (deadline IS NULL OR deadline > NOW())`,
        [id]
    );

    if (!result.affectedRows) throw new Error("TASK_CANNOT_BE_PUBLISHED");

    return { id, status: "published" };
}

async function getTasks(page = 1, limit = 20) {
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const offset = (page - 1) * limit;

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_tasks
         WHERE status = 'published'
           AND (deadline IS NULL OR deadline > NOW())`
    );

    const [rows] = await db.execute(
        `SELECT t.id, t.title, t.description, t.instructions,
                t.category, t.reward_credits, t.max_participants,
                t.deadline, t.created_at,
                COUNT(a.id) AS participant_count
         FROM contributor_tasks t
         LEFT JOIN contributor_task_assignments a
            ON a.task_id = t.id
           AND a.status <> 'cancelled'
         WHERE t.status = 'published'
           AND (t.deadline IS NULL OR t.deadline > NOW())
         GROUP BY t.id
         HAVING t.max_participants IS NULL
             OR participant_count < t.max_participants
         ORDER BY t.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );

    return {
        tasks: rows,
        pagination: {
            page,
            limit,
            total: Number(count.total),
            totalPages: Math.ceil(Number(count.total) / limit)
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

        if (!tasks.length) throw new Error("TASK_NOT_FOUND");

        const task = tasks[0];

        if (task.status !== "published") throw new Error("TASK_NOT_AVAILABLE");

        if (task.deadline && new Date(task.deadline) <= new Date()) {
            throw new Error("TASK_DEADLINE_PASSED");
        }

        const [existing] = await conn.execute(
            `SELECT id, status
             FROM contributor_task_assignments
             WHERE task_id = ? AND user_id = ?
             LIMIT 1`,
            [taskId, userId]
        );

        if (existing.length) throw new Error("TASK_ALREADY_ACCEPTED");

        if (task.max_participants !== null) {
            const [[count]] = await conn.execute(
                `SELECT COUNT(*) AS total
                 FROM contributor_task_assignments
                 WHERE task_id = ? AND status <> 'cancelled'`,
                [taskId]
            );

            if (Number(count.total) >= Number(task.max_participants)) {
                throw new Error("TASK_FULL");
            }
        }

        const [result] = await conn.execute(
            `INSERT INTO contributor_task_assignments (task_id, user_id)
             VALUES (?, ?)`,
            [taskId, userId]
        );

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

async function submitWork(userId, assignmentId, data) {
    userId = positiveId(userId, "INVALID_USER_ID");
    assignmentId = positiveId(assignmentId, "INVALID_ASSIGNMENT_ID");

    const content = String(data.content || "").trim();
    if (!content) throw new Error("SUBMISSION_CONTENT_REQUIRED");

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

        if (!assignments.length) throw new Error("ASSIGNMENT_NOT_FOUND");

        const assignment = assignments[0];

        if (assignment.task_status === "closed") {
            throw new Error("TASK_CLOSED");
        }

        if (assignment.deadline && new Date(assignment.deadline) <= new Date()) {
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
                t.title, t.category, t.reward_credits, t.deadline,
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
                t.title AS task_title
         FROM contributor_submissions s
         JOIN contributor_task_assignments a
            ON a.id = s.assignment_id
         JOIN contributor_tasks t ON t.id = a.task_id
         WHERE a.user_id = ?
         ORDER BY s.id DESC`,
        [userId]
    );

    return rows;
}


async function reviewSubmission(reviewerId, submissionId, data = {}, audit = {}) {
    reviewerId = positiveId(reviewerId, "INVALID_REVIEWER_ID");
    submissionId = positiveId(submissionId, "INVALID_SUBMISSION_ID");

    const decision = String(data.decision || "").trim();
    const feedback = data.feedback == null
        ? null
        : String(data.feedback).trim();

    if (!["approved", "rejected", "revision_requested"].includes(decision)) {
        throw new Error("INVALID_REVIEW_DECISION");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // Khóa submission và lấy thông tin người nộp, nhiệm vụ.
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

        // Không cho phép tự xét duyệt.
        if (Number(submission.contributor_user_id) === reviewerId) {
            throw new Error("SELF_REVIEW_NOT_ALLOWED");
        }

        // Chỉ xét duyệt bài đang chờ xử lý.
        if (submission.submission_status !== "submitted") {
            throw new Error("SUBMISSION_ALREADY_REVIEWED");
        }

        if (submission.reward_transaction_id != null) {
            throw new Error("REWARD_ALREADY_GRANTED");
        }

        // Ghi kết quả xét duyệt.
        const [reviewResult] = await conn.execute(
            `INSERT INTO contributor_reviews (
                submission_id,
                reviewer_user_id,
                decision,
                feedback
            ) VALUES (?, ?, ?, ?)`,
            [
                submissionId,
                reviewerId,
                decision,
                feedback
            ]
        );

        let rewardResult = null;
        let rewardCredits = 0;

        if (decision === "approved") {
            const credits = BigInt(submission.reward_credits);

            if (credits < 0n || credits > MAX_CREDITS) {
                throw new Error("INVALID_REWARD");
            }

            // Chỉ cộng Credits nếu nhiệm vụ có mức thưởng lớn hơn 0.
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

            // Hoàn thành assignment.
            await conn.execute(
                `UPDATE contributor_task_assignments
                 SET status = 'completed',
                     completed_at = NOW()
                 WHERE id = ?`,
                [submission.assignment_id]
            );
        }

        // Cập nhật trạng thái submission.
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

        // Ghi Audit Log trong cùng transaction.
        await conn.execute(
            `INSERT INTO contributor_audit_logs (
                actor_user_id,
                target_user_id,
                action,
                entity_type,
                entity_id,
                old_data,
                new_data,
                ip_address,
                user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                reviewerId,
                submission.contributor_user_id,
                "submission.reviewed",
                "contributor_submission",
                String(submissionId),
                JSON.stringify({
                    status: submission.submission_status
                }),
                JSON.stringify({
                    decision,
                    feedback,
                    rewardCredits,
                    rewardTransactionId: rewardResult
                        ? rewardResult.transactionId
                        : null
                }),
                audit.ipAddress || null,
                audit.userAgent || null
            ]
        );

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
    publishTask,
    getTasks,
    acceptTask,
    submitWork,
    getMyAssignments,
    getMySubmissions,
    reviewSubmission
};