// =========================================
// services/ai/airdrop.decision.engine.js
// =========================================

"use strict";

const strategyEngine =
    require("./airdrop.strategy.engine");

const learning =
    require("./airdrop.learning.engine");

const adaptive =
    require("./airdrop.adaptive.engine");

/* =========================================
   DEFAULT WEIGHTS
========================================= */

const DEFAULT_WEIGHTS = {

    fundamental_weight: 40,

    upside_weight: 25,

    wallet_weight: 15,

    unlock_weight: 10,

    risk_weight: 10

};

/* =========================================
   BUILD FEATURES
========================================= */

function buildFeatures({

    wallet = {},

    project = {},

    metrics = {}

} = {}) {

    return {

        project_id:
            project.id || null,

        project_name:
            project.name || "",

        wallet_roi:
            Number(wallet.roi || 0),

        wallet_risk:
            Number(wallet.risk_score || 0),

        score:
            Number(metrics.total_score || 0),

        risk:
            metrics.risk_level || "medium",

        fdv:
            Number(metrics.fdv || 0),

        market_cap:
            Number(metrics.market_cap || 0),

        current_price:
            Number(metrics.current_price || 0),

        fair_buy_price:
            Number(metrics.fair_buy_price || 0),

        circulating_supply:
            Number(metrics.circulating_supply || 0),

        max_supply:
            Number(metrics.max_supply || 0),

        ath_price:
            Number(metrics.ath_price || 0)

    };

}

/* =========================================
   CALCULATE UPSIDE
========================================= */

function calculateUpside(features) {

    if (
        !features.current_price ||
        !features.fair_buy_price
    ) {

        return 1;

    }

    return (
        features.fair_buy_price /
        features.current_price
    );

}

/* =========================================
   UNLOCK RISK
========================================= */

function calculateUnlockRisk(features) {

    if (
        !features.max_supply ||
        !features.circulating_supply
    ) {

        return 0;

    }

    return 1 -

    (
        features.circulating_supply /
        features.max_supply
    );

}

/* =========================================
   ATH RATIO
========================================= */

function calculateNearATH(features) {

    if (
        !features.ath_price ||
        !features.current_price
    ) {

        return 0;

    }

    return (

        features.current_price /

        features.ath_price

    );

}

/* =========================================
   SCORE
========================================= */

function score(

    features,

    weights = DEFAULT_WEIGHTS

) {

    let total = 50;

    total +=

        (features.score / 100) *

        weights.fundamental_weight;

    const upside =
        calculateUpside(features);

    if (upside > 1.5) {

        total +=
            weights.upside_weight;

    }

    if (upside > 2) {

        total += 10;

    }

    const unlock =
        calculateUnlockRisk(features);

    if (unlock > 0.7) {

        total -=
            weights.unlock_weight;

    }

    const ath =
        calculateNearATH(features);

    if (ath > 0.9) {

        total -= 15;

    }

    if (

        features.wallet_roi >

        100

    ) {

        total +=
            weights.wallet_weight;

    }

    switch (features.risk) {

        case "very-high":

            total -= 40;

            break;

        case "high":

            total -= 25;

            break;

        case "medium":

            total -= 10;

            break;

    }

    return Math.max(

        0,

        Math.min(100, Math.round(total))

    );

}

/* =========================================
   DECISION
========================================= */

function decide(score) {

    if (score >= 80) {

        return {

            action: "ACCUMULATE",

            confidence: "HIGH"

        };

    }

    if (score >= 65) {

        return {

            action: "BUY",

            confidence: "MEDIUM"

        };

    }

    if (score >= 50) {

        return {

            action: "HOLD",

            confidence: "LOW"

        };

    }

    if (score >= 30) {

        return {

            action: "WATCH",

            confidence: "LOW"

        };

    }

    return {

        action: "AVOID",

        confidence: "HIGH"

    };

}

/* =========================================
   REASONS
========================================= */

function generateReason(

    features,

    scoreValue

) {

    const reasons = [];

    if (

        features.score >= 80

    ) {

        reasons.push(

            "Strong fundamentals"

        );

    }

    if (

        calculateUpside(features) > 2

    ) {

        reasons.push(

            "High upside potential"

        );

    }

    if (

        calculateUnlockRisk(features) >

        0.7

    ) {

        reasons.push(

            "Large future unlock"

        );

    }

    if (

        features.risk === "high" ||

        features.risk === "very-high"

    ) {

        reasons.push(

            "High project risk"

        );

    }

    if (

        scoreValue >= 80

    ) {

        reasons.push(

            "Excellent AI score"

        );

    }

    return reasons;

}

/* =========================================
   ANALYZE DECISION
========================================= */

async function analyzeDecision(input = {}) {

    const performance =

        await learning.analyzePerformance(

            input.userId

        );

    const weights =

        adaptive.adjustWeights(

            DEFAULT_WEIGHTS,

            performance

        );

    const features =

        buildFeatures(input);

    const scoreValue =

        score(

            features,

            weights

        );

    const decision =

        decide(scoreValue);

    const strategy =

        strategyEngine.generateStrategy({

            decision,

            features,

            wallet:

                input.wallet || {}

        });

    return {

        features,

        weights,

        performance,

        score:

            scoreValue,

        action:

            decision.action,

        confidence:

            decision.confidence,

        reasoning:

            generateReason(

                features,

                scoreValue

            ),

        strategy

    };

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    DEFAULT_WEIGHTS,

    buildFeatures,

    score,

    decide,

    generateReason,

    analyzeDecision

};