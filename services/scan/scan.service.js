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

if(results.website.success){

    context.html =
        results.website.data.html;

    context.text =
        results.website.data.text;

}

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

context.coingecko =
results.coingecko.data || {};

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

context.geckoterminal =

    results.geckoterminal.data || {};

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


console.log(
    "========== TEAM AI RESULT =========="
);

console.dir(
    results.team_ai,
    {
        depth:null
    }
);

/*
=====================================
   TEAM
=====================================
*/

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

console.log("========== SCAN RESULTS ==========");

Object.entries(results).forEach(([name, result]) => {

    console.log(
        name,
        "success:",
        result.success,
        "data:",
        result.data
    );

});

    /*
    =====================================
       BUILD METRICS
    =====================================
    */

const metrics = {


    ...(results.website.data || {}),

    ...(results.github.data || {}),

    ...(results.coingecko.data || {}),

    ...(results.defillama.data || {}),

    ...(results.audit.data || {}),


    ...(results.team.data || {}),


    team_ai_count:
        results.team.data?.team_count || 0,

    team_ai_members:
        results.team.data?.team_members || [],

    team_ai_extracted:
        results.team.data?.team_members || [],


    ...(results.partner.data || {}),

    ...(results.investor.data || {}),

    ...(results.tokenomics.data || {}),


    ...(results.financial.data || {}),

    ...(results.community.data || {}),


    /*
    ================================
       ONCHAIN SCORE ONLY
       không cho overwrite market
    ================================
    */

    ...(results.onchain.data || {}),


    /*
    ================================
       MARKET DATA CUỐI CÙNG
    ================================
    */

    ...(results.geckoterminal.data || {})

};

const scoreSummary = createScoreSummary({

    team_score:
        metrics.team_score,

    investor_score:
        metrics.investor_score,

    partner_score:
        metrics.partner_score,

    tokenomics_score:
        metrics.tokenomics_score,

    financial_score:
        metrics.financial_score,

    community_score:
        metrics.community_score,

    development_score:
        metrics.development_score,

    onchain_score:
        metrics.onchain_score

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
console.log(
    "========== PRICE DEBUG =========="
);

console.table({

    coinGecko_price:
        results.coingecko.data?.current_price,

    geckoTerminal_price:
        results.geckoterminal.data?.current_price,


    final_price:
        metrics.current_price,


    coinGecko_market:
        results.coingecko.data?.market_cap,


    geckoTerminal_market:
        results.geckoterminal.data?.market_cap,


    final_market:
        metrics.market_cap

});

console.log(
    "================================="
);

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