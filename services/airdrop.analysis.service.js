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

const db =
require("../db");

const contextService =
require("./airdrop.context.service");

/* =========================================
   ANALYZE
========================================= */

async function analyze(context = {}) {

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

async function analyzeProject(
    userId,
    projectId
){
    console.log("========== ANALYZE ==========");
    console.log("projectId =", projectId);

    const context =
        await contextService.getProjectContext(

            userId,

            projectId

        );


   const analysis =
    await analyze(
        context
    );

console.log("analysis =", analysis);
    await db.query(
`
UPDATE airdrop_projects
SET

score=?,

risk=? ,

updated_at=?

WHERE id=?

`,
[

analysis.score?.overall_score || 0,

analysis.risk?.risk_score || 0,

Date.now(),

projectId

]);

console.log(result);
    return analysis;

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    analyze,

    analyzeProject

};