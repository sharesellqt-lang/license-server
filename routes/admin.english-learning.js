
"use strict";

const express = require("express");
const crypto = require("crypto");
const db = require("../db");

const ACCESS_VALUES = ["free", "pro", "vip"];


const CONFIGS = {
    lessons: {
        table: "english_lessons",
        columns: ["title", "level", "topic", "description", "access", "status", "sort_order"],
        required: ["title", "level", "topic"],
        statuses: ["draft", "published", "hidden", "archived"],
        filters: ["status", "level", "topic"]
    },

    vocabulary: {
        table: "english_vocabulary",
        columns: ["lesson_id", "word", "pronunciation", "meaning", "example", "example_vi", "progress_key", "sort_order", "status"],
        required: ["lesson_id", "word", "progress_key"],
        statuses: ["published", "hidden", "archived"],
        filters: ["status", "lesson_id"]
    },

    grammar: {
        table: "english_grammar",
        columns: ["lesson_id", "title", "level", "topic", "rule", "formula", "examples", "access", "status", "sort_order"],
        required: ["lesson_id", "title", "level"],
        statuses: ["draft", "published", "hidden", "archived"],
        filters: ["status", "lesson_id", "level", "topic"],
        jsonFields: ["examples"]
    },

    quizzes: {
        table: "english_quizzes",
        columns: ["lesson_id", "level", "topic", "question", "explanation", "access", "status", "sort_order"],
        required: ["lesson_id", "level", "question"],
        statuses: ["draft", "published", "hidden", "archived"],
        filters: ["status", "lesson_id", "level", "topic"]
    },

    conversations: {
        table: "english_conversations",
        columns: ["lesson_id", "topic", "prompt", "model", "translation", "tips", "access", "status", "sort_order"],
        required: ["lesson_id", "topic", "prompt", "model"],
        statuses: ["draft", "published", "hidden", "archived"],
        filters: ["status", "lesson_id", "topic"]
    }
};


/* =========================================
   COMMON HELPERS
========================================= */

function sendError(res, err, message = "Internal server error") {
    console.error("[English Learning Admin]", err);
    return res.status(500).json({ error: message });
}

function validId(id) {
    return typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}

function validBody(body) {
    return body !== null && typeof body === "object" && !Array.isArray(body);
}

function isDuplicateError(err) {
    return err?.code === "ER_DUP_ENTRY";
}

function parseJsonFields(config, row) {
    if (!row) return row;

    const result = { ...row };

    for (const field of config.jsonFields || []) {
        if (typeof result[field] === "string") {
            try {
                result[field] = JSON.parse(result[field]);
            } catch {
                result[field] = [];
            }
        }
    }

    return result;
}

/* =========================================
   PAYLOAD VALIDATION
========================================= */

function normalizePayload(config, body, partial = false) {
    if (!validBody(body)) return { error: "Invalid request body" };

    const data = {};

    for (const column of config.columns) {
        if (!Object.prototype.hasOwnProperty.call(body, column)) continue;

        const value = body[column];

        if (column === "sort_order") {
            if (value === null || value === "") {
                data[column] = 0;
                continue;
            }

            const number = Number(value);
            if (!Number.isInteger(number)) {
                return { error: "sort_order must be an integer" };
            }

            data[column] = number;
            continue;
        }
        if (column === "access") {
            if (!ACCESS_VALUES.includes(value)) return { error: "Invalid access value" };
            data[column] = value;
            continue;
        }

        if (column === "status") {
            if (!config.statuses.includes(value)) return { error: "Invalid status value" };
            data[column] = value;
            continue;
        }

        if ((config.jsonFields || []).includes(column)) {
            if (value === null) {
                data[column] = null;
                continue;
            }

            let jsonValue = value;

            if (typeof value === "string") {
                try {
                    jsonValue = JSON.parse(value);
                } catch {
                    return { error: `${column} must contain valid JSON` };
                }
            }

            if (!Array.isArray(jsonValue)) return { error: `${column} must be an array` };

            data[column] = JSON.stringify(jsonValue);
            continue;
        }

        if (value !== null && typeof value !== "string") {
            return { error: `${column} must be a string` };
        }

        data[column] = typeof value === "string" ? value.trim() : null;
    }

    for (const field of config.required) {
        if (!partial && (
            !Object.prototype.hasOwnProperty.call(data, field) ||
            data[field] === null ||
            data[field] === ""
        )) {
            return { error: `${field} is required` };
        }

        if (partial &&
            Object.prototype.hasOwnProperty.call(data, field) &&
            (data[field] === null || data[field] === "")
        ) {
            return { error: `${field} cannot be empty` };
        }
    }

    return { data };
}

/* =========================================
   DATABASE HELPERS
========================================= */

async function checkLesson(lessonId, executor = db) {
    if (!validId(lessonId)) return false;

    const [rows] = await executor.execute(
        `SELECT id
         FROM english_lessons
         WHERE id = ?
           AND status != 'archived'
         LIMIT 1`,
        [lessonId]
    );

    return rows.length > 0;
}

const LESSON_CHILD_RESOURCES = [
    "vocabulary",
    "grammar",
    "quizzes",
    "conversations"
];

async function validateLessonResource(resource, data) {
    if (!LESSON_CHILD_RESOURCES.includes(resource)) return null;

    if (!data.lesson_id || !(await checkLesson(data.lesson_id))) {
        return "Lesson not found";
    }

    return null;
}

async function recordExists(table, id, executor = db) {
    const [rows] = await executor.execute(
        `SELECT id FROM ${table} WHERE id = ? LIMIT 1`,
        [id]
    );

    return rows.length > 0;
}

function buildInsert(table, id, data) {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => "?").join(", ");

    return {
        sql: `INSERT INTO ${table} (id, ${columns.join(", ")}) VALUES (?, ${placeholders})`,
        values: [id, ...columns.map(column => data[column])]
    };
}

function buildUpdate(table, data, id) {
    const columns = Object.keys(data);

    return {
        sql: `UPDATE ${table} SET ${columns.map(column => `${column} = ?`).join(", ")} WHERE id = ?`,
        values: [...columns.map(column => data[column]), id]
    };
}

/* =========================================
   QUIZ ANSWERS
========================================= */

function validateQuizAnswers(answers) {
    if (!Array.isArray(answers) || answers.length !== 4) {
            return "A quiz must have exactly 4 answers";
        }

    let correctCount = 0;
    const ids = new Set();

    for (const answer of answers) {
        if (!validBody(answer)) return "Invalid answer data";

        if (typeof answer.answer_text !== "string" || !answer.answer_text.trim()) {
            return "Each answer must have answer_text";
        }

        if (answer.is_correct !== true && answer.is_correct !== false) {
            return "is_correct must be true or false";
        }

        if (answer.is_correct) correctCount++;

        if (answer.id !== undefined) {
            if (!validId(answer.id)) return "Invalid answer ID";
            if (ids.has(answer.id)) return "Duplicate answer ID";
            ids.add(answer.id);
        }

        if (answer.sort_order !== undefined &&
            (answer.sort_order === null ||
             answer.sort_order === "" ||
             !Number.isInteger(Number(answer.sort_order)))) {
            return "Answer sort_order must be an integer";
        }
    }

    if (correctCount !== 1) return "A quiz must have exactly one correct answer";

    return null;
}

async function saveQuizAnswers(connection, quizId, answers) {
    const validationError = validateQuizAnswers(answers);
    if (validationError) throw new Error(validationError);

    await connection.execute(
        "DELETE FROM english_quiz_answers WHERE quiz_id = ?",
        [quizId]
    );

    for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const answerId = answer.id || crypto.randomUUID();

        await connection.execute(
            `INSERT INTO english_quiz_answers
                (id, quiz_id, answer_text, is_correct, sort_order)
             VALUES (?, ?, ?, ?, ?)`,
            [
                answerId,
                quizId,
                answer.answer_text.trim(),
                answer.is_correct ? 1 : 0,
                answer.sort_order === undefined ? i : Number(answer.sort_order)
            ]
        );
    }
}

async function getQuizAnswers(quizId, executor = db) {
    const [rows] = await executor.execute(
        `SELECT id, quiz_id, answer_text, is_correct, sort_order
         FROM english_quiz_answers
         WHERE quiz_id = ?
         ORDER BY sort_order ASC`,
        [quizId]
    );

    return rows.map(answer => ({
    ...answer,
    is_correct: Boolean(answer.is_correct)
}));
}

/* =========================================
   ROUTER FACTORY
========================================= */

module.exports = function createEnglishLearningAdminRouter(adminAuth) {
    if (typeof adminAuth !== "function") {
        throw new Error("adminAuth middleware is required");
    }

    const router = express.Router();
    router.use(adminAuth);

    /* =====================================
       GET LIST
       GET /:resource
    ===================================== */

    router.get("/:resource", async (req, res) => {
        try {
            const config = CONFIGS[req.params.resource];

            if (!config) return res.status(404).json({ error: "Resource not found" });

            const conditions = [];
            const values = [];

            for (const field of config.filters) {
                const value = req.query[field];
                if (value === undefined || value === "") continue;

                if (field === "status" && !config.statuses.includes(value)) {
                    return res.status(400).json({ error: "Invalid status filter" });
                }

                conditions.push(`${field} = ?`);
                values.push(value);
            }

            const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

            const [rows] = await db.execute(
                `SELECT * FROM ${config.table}
                 ${where}
                 ORDER BY sort_order ASC, created_at DESC`,
                values
            );

            const result = rows.map(row => parseJsonFields(config, row));

            if (req.params.resource === "quizzes" && result.length) {
                const ids = result.map(item => item.id);
                const placeholders = ids.map(() => "?").join(", ");

                const [answers] = await db.execute(
                    `SELECT id, quiz_id, answer_text, is_correct, sort_order
                     FROM english_quiz_answers
                     WHERE quiz_id IN (${placeholders})
                     ORDER BY sort_order ASC`,
                    ids
                );

                const answerMap = new Map();

                for (const answer of answers) {
                    if (!answerMap.has(answer.quiz_id)) answerMap.set(answer.quiz_id, []);
                    answerMap.get(answer.quiz_id).push({
                        ...answer,
                        is_correct: Boolean(answer.is_correct)
                    });
                }

                for (const quiz of result) {
                    quiz.answers = answerMap.get(quiz.id) || [];
                }
            }

            return res.json(result);

        } catch (err) {
            return sendError(res, err);
        }
    });

    /* =====================================
       GET DETAIL
       GET /:resource/:id
    ===================================== */

    router.get("/:resource/:id", async (req, res) => {
        try {
            const config = CONFIGS[req.params.resource];
            const { id } = req.params;

            if (!config) return res.status(404).json({ error: "Resource not found" });
            if (!validId(id)) return res.status(400).json({ error: "Invalid ID" });

            const [rows] = await db.execute(
                `SELECT * FROM ${config.table} WHERE id = ? LIMIT 1`,
                [id]
            );

            if (!rows.length) return res.status(404).json({ error: "Record not found" });

            const item = parseJsonFields(config, rows[0]);

            if (req.params.resource === "quizzes") {
                item.answers = await getQuizAnswers(id);
            }

            return res.json(item);

        } catch (err) {
            return sendError(res, err);
        }
    });

    /* =====================================
       CREATE
       POST /:resource
    ===================================== */

    router.post("/:resource", async (req, res) => {
        try {
            const config = CONFIGS[req.params.resource];
            const body = req.body || {};

            if (!config) return res.status(404).json({ error: "Resource not found" });
            if (!validBody(body)) return res.status(400).json({ error: "Invalid request body" });

            const id = body.id;
            if (!validId(id)) return res.status(400).json({ error: "Invalid or missing ID" });

            const normalized = normalizePayload(config, body);
            if (normalized.error) return res.status(400).json({ error: normalized.error });

            const data = normalized.data;

            const lessonError = await validateLessonResource(req.params.resource, data);
                if (lessonError) {
                    return res.status(400).json({ error: lessonError });
                }

            if (req.params.resource === "quizzes") {
                const validationError = validateQuizAnswers(body.answers);
                if (validationError) return res.status(400).json({ error: validationError });

                const connection = await db.getConnection();
                let transactionStarted = false;

                try {
                    await connection.beginTransaction();
                    transactionStarted = true;

                    const insert = buildInsert(config.table, id, data);
                    await connection.execute(insert.sql, insert.values);
                    await saveQuizAnswers(connection, id, body.answers);

                    await connection.commit();
                    transactionStarted = false;

                    return res.status(201).json({ success: true, id });

                } catch (err) {
                    if (transactionStarted) await connection.rollback();
                    throw err;
                } finally {
                    connection.release();
                }
            }

            const insert = buildInsert(config.table, id, data);
            await db.execute(insert.sql, insert.values);

            return res.status(201).json({ success: true, id });

        } catch (err) {
            if (isDuplicateError(err)) {
                return res.status(409).json({ error: "ID already exists" });
            }

            if (err.message && (
                err.message.includes("answer") ||
                err.message.includes("correct")
            )) {
                return res.status(400).json({ error: err.message });
            }

            return sendError(res, err);
        }
    });

    /* =====================================
       UPDATE
       PUT /:resource/:id
    ===================================== */

    router.put("/:resource/:id", async (req, res) => {
        try {
            const config = CONFIGS[req.params.resource];
            const { id } = req.params;
            const body = req.body || {};

            if (!config) return res.status(404).json({ error: "Resource not found" });
            if (!validId(id)) return res.status(400).json({ error: "Invalid ID" });
            if (!validBody(body)) return res.status(400).json({ error: "Invalid request body" });

            const normalized = normalizePayload(config, body, true);
            if (normalized.error) return res.status(400).json({ error: normalized.error });

            const data = normalized.data;
            const isQuiz = req.params.resource === "quizzes";
            const hasAnswers = Object.prototype.hasOwnProperty.call(body, "answers");

            if (!Object.keys(data).length && !(isQuiz && hasAnswers)) {
                return res.status(400).json({ error: "No fields to update" });
            }

            if (Object.prototype.hasOwnProperty.call(data, "lesson_id")) {
                const lessonError = await validateLessonResource(
                    req.params.resource,
                    data
                );

                if (lessonError) {
                    return res.status(400).json({ error: lessonError });
                }
            }

            if (isQuiz && hasAnswers) {
                const validationError = validateQuizAnswers(body.answers);
                if (validationError) return res.status(400).json({ error: validationError });
            }

            if (isQuiz) {
                const connection = await db.getConnection();
                let transactionStarted = false;

                try {
                    await connection.beginTransaction();
                    transactionStarted = true;

                    const [rows] = await connection.execute(
                        "SELECT id FROM english_quizzes WHERE id = ? FOR UPDATE",
                        [id]
                    );

                    if (!rows.length) {
                        await connection.rollback();
                        transactionStarted = false;
                        return res.status(404).json({ error: "Record not found" });
                    }

                    if (Object.keys(data).length) {
                        const update = buildUpdate(config.table, data, id);
                        await connection.execute(update.sql, update.values);
                    }

                    if (hasAnswers) {
                        await saveQuizAnswers(connection, id, body.answers);
                    }

                    await connection.commit();
                    transactionStarted = false;

                    return res.json({ success: true, id });

                } catch (err) {
                    if (transactionStarted) await connection.rollback();
                    throw err;
                } finally {
                    connection.release();
                }
            }

            if (!(await recordExists(config.table, id))) {
                return res.status(404).json({ error: "Record not found" });
            }

            const update = buildUpdate(config.table, data, id);
            await db.execute(update.sql, update.values);

            return res.json({ success: true, id });

        } catch (err) {
            if (isDuplicateError(err)) {
                return res.status(409).json({ error: "ID already exists" });
            }

            return sendError(res, err);
        }
    });

    /* =====================================
       UPDATE STATUS
       PATCH /:resource/:id/status
    ===================================== */

    router.patch("/:resource/:id/status", async (req, res) => {
        try {
            const config = CONFIGS[req.params.resource];
            const { id } = req.params;
            const body = req.body || {};
            const status = body.status;

            if (!config) return res.status(404).json({ error: "Resource not found" });
            if (!validId(id)) return res.status(400).json({ error: "Invalid ID" });
            if (!validBody(body)) return res.status(400).json({ error: "Invalid request body" });

            if (!config.statuses.includes(status)) {
                return res.status(400).json({ error: "Invalid status" });
            }

            if (!(await recordExists(config.table, id))) {
                return res.status(404).json({ error: "Record not found" });
            }

            await db.execute(
                `UPDATE ${config.table} SET status = ? WHERE id = ?`,
                [status, id]
            );

            return res.json({ success: true, id, status });

        } catch (err) {
            return sendError(res, err);
        }
    });

    /* =====================================
   DELETE / ARCHIVE
   DELETE /:resource/:id

   Soft delete: chuyển status sang archived.
   Không xóa vật lý dữ liệu.
===================================== */

router.delete("/:resource/:id", async (req, res) => {
    try {
        const config = CONFIGS[req.params.resource];
        const { id } = req.params;

        if (!config) {
            return res.status(404).json({ error: "Resource not found" });
        }

        if (!validId(id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }

        if (!config.statuses.includes("archived")) {
            return res.status(400).json({
                error: "This resource does not support archiving"
            });
        }

        if (!(await recordExists(config.table, id))) {
            return res.status(404).json({ error: "Record not found" });
        }

        await db.execute(
            `UPDATE ${config.table} SET status = 'archived' WHERE id = ?`,
            [id]
        );

        return res.json({
            success: true,
            id,
            status: "archived"
        });

    } catch (err) {
        return sendError(res, err);
    }
});

    return router;
};
