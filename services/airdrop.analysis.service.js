// =========================================
// services/airdrop.analysis.service.js
// =========================================

"use strict";

const valuation =
    require("./analysis/valuation");

const tokenomics =
    require("./analysis/tokenomics");

const risk =
    require("./analysis/risk");

const roi =
    require("./analysis/roi");

const score =
    require("./analysis/score");

const recommendation =
    require("./analysis/recommendation");

/* =========================================
   ANALYZE
========================================= */

function analyze(context = {}) {

    const project =

    context.project || {};

const metrics =

    context.metrics || {};

const investors =

    context.investors || [];

const partners =

    context.partners || [];

const team =

    context.team || [];

const notes =

    context.notes || [];

const source = {

    ...metrics

};

    /* -------------------------------------
       VALUATION
    ------------------------------------- */

    const valuationData =
        valuation.calculate(source);

    /* -------------------------------------
       TOKENOMICS
    ------------------------------------- */

    const tokenomicsData =
        tokenomics.calculate({

            ...source,

            ...valuationData

        });

    /* -------------------------------------
       RISK
    ------------------------------------- */

    const riskData =
        risk.calculate({

            ...source,

            ...valuationData,

            ...tokenomicsData

        });

    /* -------------------------------------
       ROI
    ------------------------------------- */

    const roiData =
        roi.calculate({

            ...source,

            ...valuationData

        });

    /* -------------------------------------
       SCORE
    ------------------------------------- */

    const scoreData =
        score.calculate({

            ...source,

            ...valuationData,

            ...tokenomicsData,

            ...riskData,

            ...roiData

        });

    /* -------------------------------------
       RECOMMENDATION
    ------------------------------------- */

    const recommendationData =
        recommendation.generate({

            ...source,

            ...valuationData,

            ...tokenomicsData,

            ...riskData,

            ...roiData,

            ...scoreData

        });

    /* -------------------------------------
       SUMMARY
    ------------------------------------- */

    const summary = {

        overall_score:

            scoreData.overall_score,

        risk_level:

            riskData.risk_level,

        recommendation:

            recommendationData.recommendation,

        action:

            recommendationData.action,

        badge:

            recommendationData.badge,

        reasons:

            recommendationData.reasons,

        warnings:

            recommendationData.warnings

    };

    /* -------------------------------------
       RETURN
    ------------------------------------- */

return {

    project,

    metrics: source,

    investors,

    partners,

    team,

    notes,

    valuation: valuationData,

    tokenomics: tokenomicsData,

    risk: riskData,

    roi: roiData,

    score: scoreData,

    recommendation: recommendationData,

    summary

};

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    analyze

};