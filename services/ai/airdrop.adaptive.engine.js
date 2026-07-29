"use strict";

/* =========================================
   ADJUST PORTFOLIO WEIGHTS
========================================= */

const CONFIG = {

    WIN_RATE_HIGH: 65,
    WIN_RATE_LOW: 40,
    LOSS_RATE_HIGH: 60,

    MAX_ALLOCATION: 20,
    SAFE_ALLOCATION: 10,

    MIN_WEIGHT: 0.5,
    MAX_WEIGHT: 2.0

};

/* =========================================
   HELPERS
========================================= */

function number(value) {

    value = Number(value);

    if (!Number.isFinite(value)) {

        return 0;

    }

    return value;

}

function clamp(value, min, max) {

    return Math.min(
        Math.max(value, min),
        max
    );

}

/* =========================================
   ADJUST WEIGHTS
========================================= */

function adjustWeights(
    baseWeights = {},
    performance = {}
) {

    const adjusted = {

        risk_penalty: 1,

        upside_weight: 1,

        allocation_cap:
            CONFIG.MAX_ALLOCATION,

        ...baseWeights

    };

    const winRate =
        number(performance.win_rate);

    const lossRate =
        number(performance.loss_rate);

    /* =========================
       GOOD PERFORMANCE
    ========================= */

    if (winRate >= CONFIG.WIN_RATE_HIGH) {

        adjusted.risk_penalty *= 0.8;

        adjusted.upside_weight *= 1.2;

    }

    /* =========================
       BAD PERFORMANCE
    ========================= */

    else if (winRate <= CONFIG.WIN_RATE_LOW) {

        adjusted.risk_penalty *= 1.3;

        adjusted.upside_weight *= 0.8;

    }

    /* =========================
       TOO MANY LOSSES
    ========================= */

    if (lossRate >= CONFIG.LOSS_RATE_HIGH) {

        adjusted.allocation_cap =
            CONFIG.SAFE_ALLOCATION;

    }

    /* =========================
       LIMIT VALUES
    ========================= */

    adjusted.risk_penalty = clamp(

        adjusted.risk_penalty,

        CONFIG.MIN_WEIGHT,

        CONFIG.MAX_WEIGHT

    );

    adjusted.upside_weight = clamp(

        adjusted.upside_weight,

        CONFIG.MIN_WEIGHT,

        CONFIG.MAX_WEIGHT

    );

    adjusted.allocation_cap = clamp(

        adjusted.allocation_cap,

        1,

        CONFIG.MAX_ALLOCATION

    );

    return adjusted;

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    adjustWeights

};