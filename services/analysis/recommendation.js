// =========================================
// services/analysis/recommendation.js
// =========================================

"use strict";

/* =========================================
   GENERATE
========================================= */

function generate(data = {}) {

    const reasons = [];

    const warnings = [];

    const score =
        Number(data.overall_score || 0);

    const risk =
        data.risk_level || "medium";

    const current =
        Number(data.current_price || 0);

    const fairBuy =
        Number(data.fair_buy_price || 0);

    /* =====================================
       REASONS
    ===================================== */

    if (risk === "low") {

        reasons.push(
            "Low investment risk"
        );

    }

    if (
        fairBuy > 0 &&
        current <= fairBuy
    ) {

        reasons.push(
            "Trading below fair value"
        );

    }

    if (
        Number(data.fdv || 0) > 0 &&
        Number(data.market_cap || 0) > 0 &&
        data.fdv / data.market_cap <= 2
    ) {

        reasons.push(
            "Healthy FDV ratio"
        );

    }

    if (
        Number(data.circulating_percent || 0) >= 50
    ) {

        reasons.push(
            "Healthy circulating supply"
        );

    }

    /* =====================================
       WARNINGS
    ===================================== */

    if (
        Number(data.locked_percent || 0) >= 80
    ) {

        warnings.push(
            "Large locked token supply"
        );

    }

    if (
        Number(data.fdv || 0) >
        Number(data.market_cap || 0) * 8
    ) {

        warnings.push(
            "Very high FDV compared to Market Cap"
        );

    }

    if (
        Number(data.ath_price || 0) > 0 &&
        current >=
        Number(data.ath_price) * 0.8
    ) {

        warnings.push(
            "Price is close to ATH"
        );

    }

    /* =====================================
       RECOMMENDATION
    ===================================== */

    let recommendation =
        "Speculative";

    let action =
        "Watch";

    let badge =
        "yellow";

    if (
        score >= 90 &&
        risk === "low"
    ) {

        recommendation =
            "Strong Candidate";

        action =
            "Strong Buy";

        badge =
            "green";

    }

    else if (
        score >= 80
    ) {

        recommendation =
            "Worth Watching";

        action =
            "Buy";

        badge =
            "green";

    }

    else if (
        score >= 70
    ) {

        recommendation =
            "Speculative";

        action =
            "Watch";

        badge =
            "yellow";

    }

    else if (
        score >= 60
    ) {

        recommendation =
            "High Risk";

        action =
            "Wait";

        badge =
            "orange";

    }

    else {

        recommendation =
            "Avoid";

        action =
            "Avoid";

        badge =
            "red";

    }

    return {

        recommendation,

        action,

        badge,

        reasons,

        warnings

    };

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    generate

};