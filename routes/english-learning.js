
"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
console.log("[ENGLISH LEARNING] Router loaded");

const PLAN_LEVELS = Object.freeze({
    free: 0,
    pro: 1,
    vip: 2
});

/* =========================================
   HELPERS
========================================= */

function getAllowedAccess(user) {
    if (user?.isAdmin) return ["free", "pro", "vip"];

    const plan = String(user?.plan || "free").toLowerCase();
    const level = PLAN_LEVELS[plan] ?? 0;

    return Object.keys(PLAN_LEVELS)
        .filter(key => PLAN_LEVELS[key] <= level);
}

function hasAccess(access, allowed) {
    return allowed.includes(String(access || "free").toLowerCase());
}

function parseJson(value, fallback = []) {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeAccess(item) {
    const access = String(item.access || "free").toLowerCase();

    return {
        ...item,
        access,
        pro: access !== "free"
    };
}

function sendError(res, err, label) {
    console.error(`${label}:`, err);

    return res.status(500).json({
        success: false,
        error: "Unable to load English Learning data"
    });
}

/* =========================================
   LOAD ALL PUBLISHED CONTENT
========================================= */

async function loadEnglishData(user) {
    const allowed = getAllowedAccess(user);
    const accessSlots = allowed.map(() => "?").join(", ");

    const [lessonsResult, grammarResult, quizzesResult, conversationsResult, categoriesResult] =
        await Promise.all([
            db.query(
                `SELECT id, title, level, topic, description, access, sort_order
                 FROM english_lessons
                 WHERE status = 'published'
                   AND access IN (${accessSlots})
                 ORDER BY sort_order ASC, created_at ASC`,
                allowed
            ),

            db.query(
                `SELECT id, lesson_id, title, level, topic, rule, formula, examples, access, sort_order
                FROM english_grammar
                WHERE status = 'published'
                AND access IN (${accessSlots})
                ORDER BY sort_order ASC, created_at ASC`,
                allowed
            ),

            db.query(
                `SELECT id, lesson_id, level, topic, question, explanation, access, sort_order
                FROM english_quizzes
                WHERE status = 'published'
                AND access IN (${accessSlots})
                ORDER BY sort_order ASC, created_at ASC`,
                allowed
            ),

            db.query(
                `SELECT id, lesson_id, topic, prompt, model, translation, tips, access, sort_order
                FROM english_conversations
                WHERE status = 'published'
                AND access IN (${accessSlots})
                ORDER BY sort_order ASC, created_at ASC`,
                allowed
            ),

            db.query(
                `SELECT id, name, category_type, sort_order
                 FROM english_categories
                 WHERE status = 'active'
                 ORDER BY sort_order ASC, name ASC`
            )
        ]);

    const lessons = lessonsResult[0];
    const grammarRows = grammarResult[0];
    const quizRows = quizzesResult[0];
    const conversationRows = conversationsResult[0];
    const categories = categoriesResult[0];

    /* -------------------------------------
       VOCABULARY
       Inherits access from its lesson
    ------------------------------------- */

    let vocabularyRows = [];

    if (lessons.length) {
        const lessonIds = lessons.map(item => item.id);
        const placeholders = lessonIds.map(() => "?").join(", ");

        const [rows] = await db.query(
            `SELECT id, lesson_id, word, pronunciation, meaning,
                    example, example_vi, progress_key, sort_order
             FROM english_vocabulary
             WHERE status = 'published'
               AND lesson_id IN (${placeholders})
             ORDER BY sort_order ASC, created_at ASC`,
            lessonIds
        );

        vocabularyRows = rows;
    }

    const vocabularyMap = new Map();

    for (const word of vocabularyRows) {
        if (!vocabularyMap.has(word.lesson_id)) {
            vocabularyMap.set(word.lesson_id, []);
        }

        vocabularyMap.get(word.lesson_id).push({
            id: word.id,
            word: word.word,
            pronunciation: word.pronunciation,
            meaning: word.meaning,
            example: word.example,
            exampleVi: word.example_vi,
            progressKey: word.progress_key
        });
    }

    const lessonData = lessons.map(item => ({
        ...normalizeAccess(item),
        words: vocabularyMap.get(item.id) || []
    }));

    /* -------------------------------------
       GRAMMAR
    ------------------------------------- */

    const grammar = grammarRows.map(item => ({
        ...normalizeAccess(item),
        lessonId: item.lesson_id || null,
        examples: parseJson(item.examples, [])
    }));

    /* -------------------------------------
       QUIZ ANSWERS
    ------------------------------------- */

    let answerRows = [];

    if (quizRows.length) {
        const quizIds = quizRows.map(item => item.id);
        const placeholders = quizIds.map(() => "?").join(", ");

        const [rows] = await db.query(
            `SELECT id, quiz_id, answer_text, is_correct, sort_order
             FROM english_quiz_answers
             WHERE quiz_id IN (${placeholders})
             ORDER BY sort_order ASC, created_at ASC`,
            quizIds
        );

        answerRows = rows;
    }

    const answerMap = new Map();

    for (const answer of answerRows) {
        if (!answerMap.has(answer.quiz_id)) {
            answerMap.set(answer.quiz_id, []);
        }

        answerMap.get(answer.quiz_id).push(answer);
    }

    const quizzes = quizRows.map(item => {
        const answers = answerMap.get(item.id) || [];
        const correctIndex = answers.findIndex(answer => Boolean(answer.is_correct));

        return {
            ...normalizeAccess(item),
            lessonId: item.lesson_id || null,
            answers: answers.map(answer => answer.answer_text),
            correct: correctIndex,
            explanation: item.explanation || ""
        };
    });

    /* -------------------------------------
       CONVERSATIONS
       Compatible with EL_DATA.conversations
    ------------------------------------- */

    const conversations = {};

    for (const item of conversationRows) {
        const topic = item.topic || "general";

        if (!conversations[topic]) {
            conversations[topic] = [];
        }

        conversations[topic].push({
            id: item.id,
            lessonId: item.lesson_id || null,
            prompt: item.prompt,
            model: item.model,
            translation: item.translation || "",
            tips: item.tips || "",
            access: item.access,
            pro: item.access !== "free"
        });
    }

    /* -------------------------------------
       CATEGORIES
    ------------------------------------- */

    return {
        lessons: lessonData,
        grammar,
        quizzes,
        conversations,
        categories: categories.map(item => ({
            id: item.id,
            name: item.name,
            type: item.category_type,
            sortOrder: item.sort_order
        }))
    };
}

/* =========================================
   AUTHENTICATION
========================================= */

router.use(auth);

/* =========================================
   ALL DATA
   GET /api/english-learning/data
========================================= */

router.get(["/", "/data"], async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH DATA ERROR");
    }
});

/* =========================================
   LESSONS
   GET /lessons
   GET /lessons/:id
========================================= */

router.get("/lessons", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data: data.lessons
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH LESSONS ERROR");
    }
});

router.get("/lessons/:id", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);
        const lesson = data.lessons.find(item => item.id === req.params.id);

        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: "Lesson not found"
            });
        }

        return res.json({
            success: true,
            data: lesson
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH LESSON DETAIL ERROR");
    }
});

/* =========================================
   GRAMMAR
   GET /grammar
========================================= */

router.get("/grammar", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data: data.grammar
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH GRAMMAR ERROR");
    }
});

/* =========================================
   QUIZZES
   GET /quizzes
========================================= */

router.get("/quizzes", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data: data.quizzes
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH QUIZZES ERROR");
    }
});

/* =========================================
   CONVERSATIONS
   GET /conversations
========================================= */

router.get("/conversations", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data: data.conversations
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH CONVERSATIONS ERROR");
    }
});

/* =========================================
   CATEGORIES
   GET /categories
========================================= */

router.get("/categories", async (req, res) => {
    try {
        const data = await loadEnglishData(req.user);

        return res.json({
            success: true,
            data: data.categories
        });
    } catch (err) {
        return sendError(res, err, "ENGLISH CATEGORIES ERROR");
    }
});
console.log("[ENGLISH LEARNING] Routes registered:", [
    "/",
    "/data",
    "/lessons",
    "/lessons/:id",
    "/grammar",
    "/quizzes",
    "/conversations",
    "/categories"
]);
module.exports = router;
