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
function safeNumber(value, fallback = 0){

    value = Number(value);

    if(
        !Number.isFinite(value)
    ){
        return fallback;
    }

    return value;

}

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
    console.log("===== SCORE INPUT =====");

    console.log({

        network: project.network,

        contract: project.contract_address,

        url: project.url,

        coingecko: project.coingecko_id,

        liquidity: source.liquidity,

        volume: source.volume_24h,

        marketCap: source.market_cap

    });

    const scoreData =
        score.calculate({

            ...project,

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
UPDATE airdrop_project_metrics
SET

circulating_percent=?,
locked_percent=?,
inflation=?,

risk_score=?,
risk_level=?,

seed_roi=?,
private_roi=?,
public_roi=?,

team_score=?,
investor_score=?,
partner_score=?,
tokenomics_score=?,
financial_score=?,
community_score=?,
development_score=?,
onchain_score=?,

total_score=?,

recommendation=?,

updated_at=?

WHERE project_id=?
`,
[

safeNumber(
    analysis.tokenomics?.circulating_percent
),

safeNumber(
    analysis.tokenomics?.locked_percent
),

safeNumber(
    analysis.tokenomics?.inflation
),


safeNumber(
    analysis.risk?.risk_score
),

analysis.risk?.risk_level || "medium",


safeNumber(
    analysis.roi?.seed_roi
),

safeNumber(
    analysis.roi?.private_roi
),

safeNumber(
    analysis.roi?.public_roi
),


safeNumber(
    analysis.score?.team_score
),

safeNumber(
    analysis.score?.investor_score
),

safeNumber(
    analysis.score?.partner_score
),

safeNumber(
    analysis.score?.tokenomics_score
),

safeNumber(
    analysis.score?.financial_score
),

safeNumber(
    analysis.score?.community_score
),

safeNumber(
    analysis.score?.development_score
),

safeNumber(
    analysis.score?.onchain_score
),


safeNumber(
    analysis.score?.overall_score
),

analysis.recommendation?.recommendation ?? null,

Date.now(),

projectId

]
);

const [result] =
    await db.query(
        `
        UPDATE airdrop_projects
        SET
            score=?,
            risk=?,
            updated_at=?
        WHERE id=?
        `,
        [
            analysis.score?.overall_score || 0,
            analysis.risk?.risk_score || 0,
            Date.now(),
            projectId
        ]
    );

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