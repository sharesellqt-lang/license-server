
"use strict";

// =========================================
// routes/english-progress.js
// ENGLISH LEARNING - USER PROGRESS API
// =========================================

const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");

console.log("[ENGLISH PROGRESS] Router loaded");

// =========================================
// AUTHENTICATION
// =========================================

router.use(auth);

// =========================================
// HELPERS
// =========================================

function getUserId(req) {
    return req.user?.id || null;
}

function requireUserId(req, res) {
    const userId = getUserId(req);

    if (!userId) {
        res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
        return null;
    }

    return userId;
}

function validId(value) {
    return typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= 100;
}

function validDate(value) {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) return false;

    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
}

function isBoolean(value) {
    return typeof value === "boolean" ||
        value === 0 ||
        value === 1;
}

function sendError(res, error, label = "ENGLISH PROGRESS ERROR") {
    console.error(`[${label}]`, error);

    return res.status(500).json({
        success: false,
        message: "Unable to save or load learning progress"
    });
}

// =========================================
// GET /
// LOAD ALL USER PROGRESS
// =========================================

router.get("/", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        console.log("[PROGRESS GET]", {
    userId,
    db: db.config?.database
});
        if (!userId) return;

        const [
            lessonsResult,
            vocabularyResult,
            quizzesResult,
            studyDatesResult,
            settingsResult
        ] = await Promise.all([

            db.query(
                `SELECT lesson_id
                 FROM english_user_lesson_progress
                 WHERE user_id = ?
                   AND is_completed = 1`,
                [userId]
            ),

            db.query(
                `SELECT
                    word_id,
                    is_known,
                    is_saved,
                    DATE_FORMAT(review_due, '%Y-%m-%d') AS review_due
                 FROM english_user_vocabulary_progress
                 WHERE user_id = ?`,
                [userId]
            ),

            db.query(
                `SELECT
                    COALESCE(SUM(correct_count), 0) AS quizCorrect,
                    COALESCE(SUM(total_count), 0) AS quizAttempts
                 FROM english_user_quiz_attempts
                 WHERE user_id = ?`,
                [userId]
            ),

            db.query(
                `SELECT DATE_FORMAT(study_date, '%Y-%m-%d') AS study_date
                 FROM english_user_study_dates
                 WHERE user_id = ?
                 ORDER BY study_date ASC`,
                [userId]
            ),

            db.query(
                `SELECT word_count_goal
                 FROM english_user_settings
                 WHERE user_id = ?
                 LIMIT 1`,
                [userId]
            )
        ]);

        const lessonRows = lessonsResult[0];
        const vocabularyRows = vocabularyResult[0];
        const quizRows = quizzesResult[0];
        const studyRows = studyDatesResult[0];
        const settingRows = settingsResult[0];

        const reviewDue = {};

        for (const word of vocabularyRows) {
            if (word.review_due) {
                reviewDue[word.word_id] = word.review_due;
            }
        }

        const dates = studyRows.map(row => row.study_date);


       const progressData = {
    completedLessons: lessonRows.map(row => row.lesson_id),
    savedWords: vocabularyRows.filter(row => row.is_saved).map(row => row.word_id),
    knownWords: vocabularyRows.filter(row => row.is_known).map(row => row.word_id),
    quizAttempts: Number(quizRows[0]?.quizAttempts || 0),
    quizCorrect: Number(quizRows[0]?.quizCorrect || 0),
    studyDates: dates,
    lastStudyDate: dates.length ? dates[dates.length - 1] : "",
    reviewDue,
    wordCountGoal: Number(settingRows[0]?.word_count_goal || 100)
};

console.log("[PROGRESS GET RESPONSE]", progressData);

return res.json({
    success: true,
    progress: progressData
});
    } catch (error) {
        return sendError(res, error, "ENGLISH PROGRESS LOAD ERROR");
    }
});

// =========================================
// POST /lesson
// COMPLETE / UNCOMPLETE LESSON
// =========================================

router.post("/lesson", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        if (!userId) return;

        const {
            lessonId,
            completed = true
        } = req.body || {};

        if (
            !validId(lessonId) ||
            !isBoolean(completed)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid lesson data"
            });
        }

        if (Boolean(completed)) {
            await db.query(
                `INSERT INTO english_user_lesson_progress
                    (user_id, lesson_id, is_completed, completed_at)
                 VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    is_completed = 1,
                    completed_at = CURRENT_TIMESTAMP`,
                [userId, lessonId.trim()]
            );
        } else {
            await db.query(
                `DELETE FROM english_user_lesson_progress
                 WHERE user_id = ?
                   AND lesson_id = ?`,
                [userId, lessonId.trim()]
            );
        }

        return res.json({
            success: true,
            message: "Lesson progress saved"
        });

    } catch (error) {
        return sendError(res, error, "ENGLISH LESSON PROGRESS ERROR");
    }
});

// =========================================
// POST /vocabulary
// SAVE VOCABULARY PROGRESS
// =========================================

router.post("/vocabulary", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        console.log("[PROGRESS GET]", {
    userId,
    db: db.config?.database
});
        if (!userId) return;

        const {
            wordId,
            isKnown,
            isSaved,
            reviewDue = null
        } = req.body || {};

        if (
            !validId(wordId) ||
            !isBoolean(isKnown) ||
            !isBoolean(isSaved) ||
            (reviewDue !== null && !validDate(reviewDue))
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid vocabulary data"
            });
        }

        const known = Boolean(isKnown);
        const saved = Boolean(isSaved);

        await db.query(
            `INSERT INTO english_user_vocabulary_progress
                (user_id, word_id, is_known, is_saved, review_due, known_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                is_known = VALUES(is_known),
                is_saved = VALUES(is_saved),
                review_due = VALUES(review_due),
                known_at = VALUES(known_at)`,
            [
                userId,
                wordId.trim(),
                known ? 1 : 0,
                saved ? 1 : 0,
                reviewDue,
                known ? new Date() : null
            ]
        );

        return res.json({
            success: true,
            message: "Vocabulary progress saved"
        });

    } catch (error) {
        return sendError(res, error, "ENGLISH VOCABULARY PROGRESS ERROR");
    }
});

// =========================================
// POST /quiz
// SAVE QUIZ ATTEMPT
// =========================================

router.post("/quiz", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        if (!userId) return;

        const {
            quizId,
            correctCount,
            totalCount
        } = req.body || {};

        if (
            !validId(quizId) ||
            !Number.isInteger(correctCount) ||
            !Number.isInteger(totalCount) ||
            totalCount <= 0 ||
            correctCount < 0 ||
            correctCount > totalCount
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid quiz data"
            });
        }

        const score = Number(
            ((correctCount / totalCount) * 100).toFixed(2)
        );

        await db.query(
            `INSERT INTO english_user_quiz_attempts
                (user_id, quiz_id, correct_count, total_count, score)
             VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                quizId.trim(),
                correctCount,
                totalCount,
                score
            ]
        );

        return res.json({
            success: true,
            message: "Quiz attempt saved",
            score
        });

    } catch (error) {
        return sendError(res, error, "ENGLISH QUIZ PROGRESS ERROR");
    }
});

// =========================================
// POST /study
// RECORD STUDY DATE
// =========================================

router.post("/study", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        if (!userId) return;

        const { studyDate } = req.body || {};

        if (
            studyDate !== undefined &&
            !validDate(studyDate)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid study date"
            });
        }

        if (studyDate) {
            await db.query(
                `INSERT IGNORE INTO english_user_study_dates
                    (user_id, study_date)
                 VALUES (?, ?)`,
                [userId, studyDate]
            );
        } else {
            await db.query(
                `INSERT IGNORE INTO english_user_study_dates
                    (user_id, study_date)
                 VALUES (?, CURDATE())`,
                [userId]
            );
        }

        return res.json({
            success: true,
            message: "Study date saved"
        });

    } catch (error) {
        return sendError(res, error, "ENGLISH STUDY DATE ERROR");
    }
});

// =========================================
// POST /settings
// UPDATE LEARNING SETTINGS
// =========================================

router.post("/settings", async (req, res) => {
    try {
        const userId = requireUserId(req, res);
        if (!userId) return;

        const { wordCountGoal } = req.body || {};

        if (
            !Number.isInteger(wordCountGoal) ||
            wordCountGoal < 1 ||
            wordCountGoal > 100000
        ) {
            return res.status(400).json({
                success: false,
                message: "Word count goal must be between 1 and 100000"
            });
        }

        await db.query(
            `INSERT INTO english_user_settings
                (user_id, word_count_goal)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE
                word_count_goal = VALUES(word_count_goal)`,
            [userId, wordCountGoal]
        );

        return res.json({
            success: true,
            message: "Learning settings saved"
        });

    } catch (error) {
        return sendError(res, error, "ENGLISH SETTINGS ERROR");
    }
});

// =========================================
// ROUTES REGISTERED
// =========================================

console.log("[ENGLISH PROGRESS] Routes registered:", [
    "/",
    "/lesson",
    "/vocabulary",
    "/quiz",
    "/study",
    "/settings"
]);

module.exports = router;
