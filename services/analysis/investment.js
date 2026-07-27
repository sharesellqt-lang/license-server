"use strict";

/* =========================================
   INVESTMENT SCORE
========================================= */

function n(value) {

    value = Number(value);

    return Number.isFinite(value)
        ? value
        : 0;

}

function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}

function calculate(data = {}) {

    /* =====================================
       INPUT
    ===================================== */

    const overall =
        clamp(
            n(data.overall_score),
            0,
            100
        );

    const risk =
        clamp(
            n(data.risk_score),
            0,
            100
        );

    /* =====================================
       SAFE SCORE
       risk = 0   -> safe = 100
       risk = 100 -> safe = 0
    ===================================== */

    const safeScore =
        100 - risk;

    /* =====================================
       INVESTMENT SCORE

       80% Project Quality
       20% Risk
    ===================================== */

    const investment_score =

        overall * 0.80 +

        safeScore * 0.20;

    /* =====================================
       RATING
    ===================================== */

    let rating =
        "AVOID";

    let action =
        "Avoid";

    if (investment_score >= 80) {

        rating =
            "STRONG BUY";

        action =
            "Consider Entry";

    }

    else if (investment_score >= 65) {

        rating =
            "BUY";

        action =
            "Good Candidate";

    }

    else if (investment_score >= 50) {

        rating =
            "WATCH";

        action =
            "Monitor";

    }

    else if (investment_score >= 35) {

        rating =
            "SPECULATIVE";

        action =
            "High Risk";

    }

    console.log(
        "===== INVESTMENT SCORE ====="
    );

    console.table({

        overall,

        risk,

        safeScore,

        investment_score

    });

    return {

        investment_score:

            Number(
                investment_score.toFixed(2)
            ),

        investment_rating:
            rating,

        investment_action:
            action

    };

}

module.exports = {

    calculate

};