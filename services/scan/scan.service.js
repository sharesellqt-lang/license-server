// =========================================
// services/scan/scan.service.js
// =========================================

"use strict";

const db =
    require("../../db");

/*
=========================================
 SCAN MODULES
=========================================
*/

const projectService =
    require("../airdrop.project.service");


const metricsService =
    require("../airdrop.metrics.service");


const historyService =
    require("../airdrop.project.history.service");



const {
    scanWebsite
}
=
require("./scan.website");


const {
    scanGithub
}
=
require("./scan.github");


const {
    scanCoinGecko
}
=
require("./scan.coingecko");


const {
    scanGeckoTerminal
}
=
require("./scan.geckoterminal");


const {
    scanDefiLlama
}
=
require("./scan.defillama");


const {
    scanAudit
}
=
require("./scan.audit");


const {
    scanTeam
}
=
require("./scan.team");


const {
    scanPartner
}
=
require("./scan.partner");


const {
    scanInvestor
}
=
require("./scan.investor");


const {
    scanTokenomics
}
=
require("./scan.tokenomics");


const {
    scanNote
}
=
require("./scan.note");


const {
    createScoreSummary
}
=
require("./scan.utils");



/*
=========================================
 FINANCIAL
=========================================
*/

const {
    scanFinancial
}
=
require("./scan.financial");



/*
=========================================
 COMMUNITY
=========================================
*/

const {
    scanCommunity
}
=
require("./scan.community");



/*
=========================================
 ONCHAIN
=========================================
*/

const {
    scanOnchain
}
=
require("./scan.onchain");


/*
=========================================
 SAFE RUNNER
=========================================
*/


async function safeRun(
    name,
    fn
){

    try{


        const result =
            await fn();



        return {

            success:true,

            module:name,

            data:result

        };


    }
    catch(error){


        console.log(
            `[SCAN ERROR] ${name}`,
            error.message
        );


        return {

            success:false,

            module:name,

            error:
                error.message

        };

    }

}




/*
=========================================
 GET PROJECT
=========================================
*/


async function getProject(
    userId,
    projectId
){


    const project =
        await projectService.getProjectById(
            userId,
            projectId
        );



    if(!project){

        throw new Error(
            "Project not found"
        );

    }


    return project;

}




/*
=========================================
 MAIN SCAN PROJECT
=========================================
*/


async function scanProject(
    userId,
    projectId
){


    const project =
        await getProject(
            userId,
            projectId
        );



    console.log(
        "=============================="
    );

    console.log(
        "START AIRDROP SCAN:",
        project.name
    );

    console.log(
        "=============================="
    );



    const context = {

        project,

        projectId

    };




    /*
    =====================================
       RUN SCANNERS
    =====================================
    */

    const results = {};
console.log(project);
    results.website =

        await safeRun(

            "website",

            ()=>

                scanWebsite(
                    context
                )

        );



    results.github =

        await safeRun(

            "github",

            ()=>

                scanGithub(
                    context
                )

        );



    results.coingecko =

        await safeRun(

            "coingecko",

            ()=>

                scanCoinGecko(
                    context
                )

        );



    results.geckoterminal =

        await safeRun(

            "geckoterminal",

            ()=>

                scanGeckoTerminal(
                    context
                )

        );

console.log("===== GECKOTERMINAL RESULT =====");
console.dir(results.geckoterminal, { depth: null });

    results.defillama =

        await safeRun(

            "defillama",

            ()=>

                scanDefiLlama(
                    context
                )

        );



    results.audit =

        await safeRun(

            "audit",

            ()=>

                scanAudit(
                    context
                )

        );



    results.team =

        await safeRun(

            "team",

            ()=>

                scanTeam(
                    context
                )

        );



    results.partner =

        await safeRun(

            "partner",

            ()=>

                scanPartner(
                    context
                )

        );



    results.investor =

        await safeRun(

            "investor",

            ()=>

                scanInvestor(
                    context
                )

        );



    results.tokenomics =

        await safeRun(

            "tokenomics",

            ()=>

                scanTokenomics(
                    context
                )

        );

        results.financial =

    await safeRun(

        "financial",

        ()=>


            scanFinancial(
                context
            )

    );

    results.community =

    await safeRun(

        "community",

        ()=>


            scanCommunity(
                context
            )

    );

    results.onchain =

    await safeRun(

        "onchain",

        ()=>


            scanOnchain(
                context
            )

    );


        results.note =

            await safeRun(

                "note",

                ()=>


                    scanNote(

                        context

                    )

            );



    /*
    =====================================
       BUILD METRICS
    =====================================
    */

const metrics = {

    ...results.website.data,

    ...results.github.data,

    ...results.coingecko.data,

    ...results.geckoterminal.data,

    ...results.defillama.data,

    ...results.audit.data,

    ...results.team.data,

    ...results.partner.data,

    ...results.investor.data,

    ...results.tokenomics.data,

    ...results.financial.data,

    ...results.community.data,

    ...results.onchain.data

};


const scoreSummary =

    createScoreSummary({

        team:

            metrics.team.team_score || 0,


        investor:

            metrics.investor.investor_score || 0,


        partner:

            metrics.partner.partner_score || 0,


        tokenomics:

            metrics.tokenomics.tokenomics_score || 0,


        financial:

            metrics.defillama.defillama_score || 0,


        community:

            metrics.website.community_score || 0,


        development:

            metrics.github.github_score || 0,


        onchain:

            metrics.geckoterminal.onchain_score || 0


    });



Object.assign(

    metrics,

    scoreSummary

);

    /*
    =====================================
       SAVE METRICS
    =====================================
    */
console.log("===== METRICS SAVE =====");
console.dir(metrics, { depth: null });

    await metricsService.saveMetrics(

        projectId,

        metrics

    );




    /*
    =====================================
       SAVE HISTORY
    =====================================
    */


    await historyService.createHistory(

        projectId,

        metrics,

        "full_scan"

    );





    return {


        success:true,


        project_id:
            projectId,


        project_name:
            project.name,


        scanned_modules:

            Object.keys(results),


        results,


        metrics


    };


}





/*
=========================================
 SCAN USER PROJECTS
=========================================
*/


async function scanUserProjects(
    userId
){


    const projects =
        await projectService.getProjectsByUser(
            userId
        );



    const results=[];



    for(
        const project of projects
    ){


        const result =

            await safeRun(

                project.name,

                ()=>

                    scanProject(

                        userId,

                        project.id

                    )

            );



        results.push(
            result
        );


    }



    return {


        total:
            results.length,


        results


    };


}


/*
=========================================
 EXPORT
=========================================
*/


module.exports = {


    scanProject,


    scanUserProjects


};