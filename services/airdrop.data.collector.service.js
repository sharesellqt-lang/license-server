// =========================================
// services/airdrop.data.collector.service.js
// =========================================

"use strict";


const db = require("../db");


const coingecko =
    require("./coingecko.collector");

const coinmarketcap =
    require("./coinmarketcap.collector");


const metricsService =
    require("./airdrop.metrics.service");

const historyService =
    require("./airdrop.project.history.service");



/* =========================================
   COLLECT PROJECT MARKET DATA
========================================= */

async function collectProjectData(projectId) {


    const sql = `

        SELECT
            p.id,
            p.name,

            m.token_symbol

        FROM airdrop_projects p

        LEFT JOIN airdrop_project_metrics m

            ON p.id = m.project_id

        WHERE p.id = ?

        LIMIT 1

    `;


    const [rows] =
        await db.query(
            sql,
            [
                projectId
            ]
        );


    if (!rows.length) {

        throw new Error(
            "Project not found"
        );

    }


    const project =
        rows[0];



    if (!project.token_symbol) {


        throw new Error(
            "Token symbol missing"
        );


    }



    /*
    =====================================
       GET DATA FROM COINGECKO
    =====================================
    */


    const marketData =
        await coingecko.getTokenData(
            project.token_symbol
        );



    if (!marketData) {


        throw new Error(
            "Coin data unavailable"
        );


    }



    /*
    =====================================
       NORMALIZE METRICS
    =====================================
    */


    const metrics = {

        token_symbol:

            marketData.symbol,


        current_price:

            marketData.price,


        market_cap:

            marketData.market_cap,


        fdv:

            marketData.fdv,


        total_supply:

            marketData.total_supply,


        circulating_supply:

            marketData.circulating_supply,


        max_supply:

            marketData.max_supply,


        ath_price:

            marketData.ath,


        atl_price:

            marketData.atl

    };



    /*
    =====================================
       SAVE DATABASE
    =====================================
    */


    await metricsService.saveMetrics(

        projectId,

        metrics

    );

    await historyService.createHistory(
    projectId,
    metrics,
    "market_sync"
);



    return {

        success:true,

        project_id:

            projectId,


        metrics

    };


}



/* =========================================
   COLLECT ALL USER PROJECTS
========================================= */


async function collectUserProjects(userId){


    const sql = `

        SELECT id

        FROM airdrop_projects

        WHERE user_id=?

    `;


    const [rows] =
        await db.query(
            sql,
            [
                userId
            ]
        );



    const results = [];



    for(const p of rows){


        try{


            const data =
                await collectProjectData(
                    p.id
                );


            results.push(data);



        }
        catch(err){


            results.push({

                success:false,

                project_id:p.id,

                error:
                    err.message

            });


        }


    }



    return {


        total:

            results.length,


        results


    };


}



/* =========================================
   REFRESH SINGLE METRIC
========================================= */


async function refreshMetrics(projectId){


    return collectProjectData(
        projectId
    );


}



/* =========================================
   EXPORT
========================================= */


module.exports = {


    collectProjectData,


    collectUserProjects,


    refreshMetrics


};