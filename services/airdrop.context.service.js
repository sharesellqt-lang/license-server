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
        metrics,
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


return {
    project,
    metrics,
    investors,
    partners,
    team,
    notes
};

}

module.exports = {

    getProjectContext

};