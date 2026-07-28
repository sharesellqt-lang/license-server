"use strict";

const projectRepository =
    require("./repositories/project.repository");

const metricsService =
    require("./airdrop.metrics.service");

const investorService =
    require("./airdrop.investor.service");

const partnerService =
    require("./airdrop.partner.service");

const teamService =
    require("./airdrop.team.service");

const noteService =
    require("./airdrop.note.service");

const recommendation =
    require("./analysis/recommendation");

const risk =
    require("./analysis/risk");

const score =
    require("./analysis/score");

const roi =
    require("./analysis/roi");

const tokenomics =
    require("./analysis/tokenomics");

const valuation =
    require("./analysis/valuation");

const decision =
    require("./analysis/decision");


/* =========================================
   GET PROJECT CONTEXT
========================================= */

async function getProjectContext(userId, projectId) {

    const project =
        await projectRepository.getProjectById(
            userId,
            projectId
        );

    if (!project) {

        return null;

    }


    const [

        metricsResult,

        investors,

        partners,

        team,

        notes

    ] = await Promise.all([

        metricsService.getMetrics(projectId),

        investorService.getInvestors(projectId),

        partnerService.getPartners(projectId),

        teamService.getMembers(projectId),

        noteService.getNotes(projectId)

    ]);


    const metrics =

        Array.isArray(metricsResult)

            ? (metricsResult[0] || {})

            : (metricsResult || {});



    /*
    =========================================
       MERGE ANALYSIS DATA
    =========================================
    */

    const analysisData = {

        ...metrics,

        ...tokenomicsResult,

        ...valuationResult

    };




    /*
    =========================================
       decision
    =========================================
    */
    const decisionResult =
    decision.calculate({

        ...scoreResult,

        ...riskResult

    });
    /*
    =========================================
       RECOMMENDATION
    =========================================
    */

    const recommendationResult =
        recommendation.generate({

            ...analysisData,

            ...riskResult,

            ...scoreResult

        });

/*
=========================================
ROI
=========================================
*/
const riskResult =
    risk.calculate(
        metrics
    );


const tokenomicsResult =
    tokenomics.calculate(
        metrics
    );


const valuationResult =
    valuation.calculate(
        metrics
    );


const roiResult =
    roi.calculate(
        metrics
    );


const scoreResult =
    score.calculate({

        ...metrics,

        ...riskResult,

        ...tokenomicsResult,

        ...valuationResult

    });

    const analysis = {

    recommendation:

        recommendation.generate({

            ...metrics,

            ...riskResult,

            ...tokenomicsResult,

            ...valuationResult,

            ...scoreResult

        }),


    risk:
        riskResult,


    score:
        scoreResult,


    roi:
        roiResult,


    tokenomics:
        tokenomicsResult,


    valuation:
        valuationResult

};

return {

    project,

    metrics,

    investors,

    partners,

    team,

    notes,

    analysis

};

}

module.exports = {

    getProjectContext

};