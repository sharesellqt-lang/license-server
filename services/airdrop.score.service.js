// =========================================
// services/airdrop.score.service.js
// =========================================

"use strict";

/*
|--------------------------------------------------------------------------
| AIRDROP SCORE CONFIG
|--------------------------------------------------------------------------
| Có thể chỉnh toàn bộ thuật toán chỉ bằng cách sửa object này.
| Không cần sửa calculateScore().
|--------------------------------------------------------------------------
*/

const SCORE_CONFIG = {

    MAX_PERCENT: 100,

    FUNDING_WEIGHT: 0.40,

    COMMUNITY_WEIGHT: 0.30,

    INVESTOR_POINT: 5,

    INVESTOR_MAX: 20,

    NO_TOKEN_BONUS: 20,

    MIN_SCORE: 0,

    MAX_SCORE: 100

};

/* =========================================
   HELPERS
========================================= */

function clamp(value, min, max) {

    value = Number(value);

    if (Number.isNaN(value)) {

        value = 0;

    }

    return Math.min(
        Math.max(value, min),
        max
    );

}

function investorScore(project) {

    const investors =
        Array.isArray(project.investors)
            ? project.investors
            : [];

    return Math.min(
        investors.length *
            SCORE_CONFIG.INVESTOR_POINT,
        SCORE_CONFIG.INVESTOR_MAX
    );

}

/* =========================================
   CALCULATE SCORE
========================================= */

function calculateScore(project = {}) {

    let score = 0;

    const funding =
        clamp(
            project.funding,
            0,
            SCORE_CONFIG.MAX_PERCENT
        );

    const community =
        clamp(
            project.community,
            0,
            SCORE_CONFIG.MAX_PERCENT
        );

    score +=
        funding *
        SCORE_CONFIG.FUNDING_WEIGHT;

    score +=
        community *
        SCORE_CONFIG.COMMUNITY_WEIGHT;

    score +=
        investorScore(project);

    if (project.token === false) {

        score +=
            SCORE_CONFIG.NO_TOKEN_BONUS;

    }

    return clamp(

        Math.round(score),

        SCORE_CONFIG.MIN_SCORE,

        SCORE_CONFIG.MAX_SCORE

    );

}

/* =========================================
   RANK
========================================= */

function getRank(score) {

    score = clamp(score, 0, 100);

    if (score >= 90) {

        return "S";

    }

    if (score >= 80) {

        return "A";

    }

    if (score >= 70) {

        return "B";

    }

    if (score >= 60) {

        return "C";

    }

    return "D";

}

/* =========================================
   LABEL
========================================= */

function getRecommendation(score) {

    score = clamp(score, 0, 100);

    if (score >= 90) {

        return "Excellent";

    }

    if (score >= 80) {

        return "Very Good";

    }

    if (score >= 70) {

        return "Good";

    }

    if (score >= 60) {

        return "Average";

    }

    return "High Risk";

}

/* =========================================
   ANALYZE
========================================= */

function analyzeProject(project = {}) {

    const score =
        calculateScore(project);

    return {

        ...project,

        score,

        rank:
            getRank(score),

        recommendation:
            getRecommendation(score)

    };

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    SCORE_CONFIG,

    calculateScore,

    getRank,

    getRecommendation,

    analyzeProject

};