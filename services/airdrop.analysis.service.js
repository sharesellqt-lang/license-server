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

const investment =
require("./analysis/investment");

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
   INVESTMENT
------------------------------------- */

const investmentData =
investment.calculate({

    ...source,

    ...scoreData,

    ...riskData,

    ...tokenomicsData

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

    investment:
    investmentData,

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


    if(!context){

        throw new Error(
            "Project context not found"
        );

    }



    const analysis =
        await analyze(
            context
        );



    console.log(
        "===== SCORE RESULT ====="
    );

    console.log(
        analysis.score
    );


    /*
    =====================================
       UPSERT METRICS
    =====================================
    */


    const metrics = {


        circulating_percent:
            safeNumber(
                analysis.tokenomics?.circulating_percent
            ),


        locked_percent:
            safeNumber(
                analysis.tokenomics?.locked_percent
            ),


        inflation:
            safeNumber(
                analysis.tokenomics?.inflation
            ),



        risk_score:
            safeNumber(
                analysis.risk?.risk_score
            ),


        risk_level:
            analysis.risk?.risk_level
            ||
            "medium",



        seed_roi:
            safeNumber(
                analysis.roi?.seed_roi
            ),


        private_roi:
            safeNumber(
                analysis.roi?.private_roi
            ),


        public_roi:
            safeNumber(
                analysis.roi?.public_roi
            ),



        team_score:
            safeNumber(
                analysis.score?.team_score
            ),


        investor_score:
            safeNumber(
                analysis.score?.investor_score
            ),


        partner_score:
            safeNumber(
                analysis.score?.partner_score
            ),


        tokenomics_score:
            safeNumber(
                analysis.score?.tokenomics_score
            ),


        financial_score:
            safeNumber(
                analysis.score?.financial_score
            ),


        community_score:
            safeNumber(
                analysis.score?.community_score
            ),


        development_score:
            safeNumber(
                analysis.score?.development_score
            ),


        onchain_score:
            safeNumber(
                analysis.score?.onchain_score
            ),


        total_score:
            safeNumber(
                analysis.score?.overall_score
            ),


        investment_score:
            safeNumber(
                analysis.investment?.investment_score
            ),


        investment_rating:
            analysis.investment?.investment_rating
            ||
            "UNKNOWN",


        investment_action:
            analysis.investment?.investment_action
            ||
            "",


        recommendation:
            analysis.recommendation?.recommendation
            ||
            null


    };



    await db.query(
`
INSERT INTO airdrop_project_metrics

(
 project_id,

 circulating_percent,
 locked_percent,
 inflation,

 risk_score,
 risk_level,

 seed_roi,
 private_roi,
 public_roi,


 team_score,
 investor_score,
 partner_score,
 tokenomics_score,
 financial_score,
 community_score,
 development_score,
 onchain_score,


 total_score,


 investment_score,
 investment_rating,
 investment_action,


 recommendation,

 updated_at

)


VALUES

(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)



ON DUPLICATE KEY UPDATE


circulating_percent=VALUES(circulating_percent),
locked_percent=VALUES(locked_percent),
inflation=VALUES(inflation),


risk_score=VALUES(risk_score),
risk_level=VALUES(risk_level),


seed_roi=VALUES(seed_roi),
private_roi=VALUES(private_roi),
public_roi=VALUES(public_roi),


team_score=VALUES(team_score),
investor_score=VALUES(investor_score),
partner_score=VALUES(partner_score),
tokenomics_score=VALUES(tokenomics_score),
financial_score=VALUES(financial_score),
community_score=VALUES(community_score),
development_score=VALUES(development_score),
onchain_score=VALUES(onchain_score),


total_score=VALUES(total_score),


investment_score=VALUES(investment_score),
investment_rating=VALUES(investment_rating),
investment_action=VALUES(investment_action),


recommendation=VALUES(recommendation),

updated_at=VALUES(updated_at)

`,
[

projectId,


metrics.circulating_percent,
metrics.locked_percent,
metrics.inflation,


metrics.risk_score,
metrics.risk_level,


metrics.seed_roi,
metrics.private_roi,
metrics.public_roi,


metrics.team_score,
metrics.investor_score,
metrics.partner_score,
metrics.tokenomics_score,
metrics.financial_score,
metrics.community_score,
metrics.development_score,
metrics.onchain_score,


metrics.total_score,


metrics.investment_score,
metrics.investment_rating,
metrics.investment_action,


metrics.recommendation,


Date.now()

]

);



/*
=====================================
 UPDATE PROJECT SUMMARY
=====================================
*/


await db.query(
`
UPDATE airdrop_projects

SET

score=?,

risk=?,

updated_at=?

WHERE id=?

AND user_id=?

`,
[

metrics.total_score,

metrics.risk_score,

Date.now(),

projectId,

userId

]

);



console.log(
"========== ANALYZE DONE =========="
);



return analysis;


}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    analyze,

    analyzeProject

};