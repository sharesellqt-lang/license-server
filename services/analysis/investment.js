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

    const team =
        n(data.team_score);

    const investor =
        n(data.investor_score);

    const partner =
        n(data.partner_score);

    const tokenomics =
        n(data.tokenomics_score);

    const financial =
        n(data.financial_score);

    const community =
        n(data.community_score);

    const development =
        n(data.development_score);

    const onchain =
        n(data.onchain_score);

    const risk =
        clamp(
            n(data.risk_score),
            0,
            100
        );

    /* =====================================
       SAFE SCORE
       risk 0 = safest
       risk 100 = most dangerous
    ===================================== */

    const safeScore =
        100 - risk;

    /* =====================================
       INVESTMENT SCORE
       Max = 100
    ===================================== */

    const investment_score =

        financial * 0.30 +

        tokenomics * 0.25 +

        onchain * 0.15 +

        team * 0.10 +

        investor * 0.05 +

        partner * 0.05 +

        community * 0.05 +

        development * 0.05 +

        safeScore * 0.05;

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

        financial,

        tokenomics,

        onchain,

        team,

        investor,

        partner,

        community,

        development,

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