// =========================================
// services/airdrop.backtest.service.js
// =========================================

"use strict";


const db = require("../db");


/* =========================================
   LOAD HISTORY
========================================= */

async function getHistory(projectId){

    const sql = `

        SELECT *

        FROM airdrop_project_history

        WHERE project_id=?

        ORDER BY created_at ASC

    `;


    const [rows] =
        await db.query(
            sql,
            [
                projectId
            ]
        );


    return rows || [];

}



/* =========================================
   CALCULATE RETURN
========================================= */


function calculateROI(
    buyPrice,
    sellPrice
){

    if(
        !buyPrice ||
        !sellPrice
    ){

        return 0;

    }


    return (

        (
            sellPrice -
            buyPrice
        )
        /
        buyPrice

    )
    *
    100;


}



/* =========================================
   SIMULATE TRADE
========================================= */


function simulateTrade(
    history,
    options={}
){


    const {

        takeProfit = 50,

        stopLoss = -20

    } = options;



    if(
        history.length < 2
    ){

        return null;

    }



    const buy = history[0];



    const buyPrice =
        Number(
            buy.current_price
        );



    let result = {

        entry:

            buyPrice,


        exit:

            buyPrice,


        roi:0,


        status:"OPEN"

    };



    for(
        let i=1;
        i<history.length;
        i++
    ){


        const price =
            Number(
                history[i].current_price
            );



        const roi =
            calculateROI(
                buyPrice,
                price
            );



        if(
            roi >= takeProfit
        ){

            result.exit =
                price;


            result.roi =
                roi;


            result.status =
                "WIN";


            return result;

        }



        if(
            roi <= stopLoss
        ){

            result.exit =
                price;


            result.roi =
                roi;


            result.status =
                "LOSS";


            return result;

        }


    }



    const last =
        history[
            history.length - 1
        ];



    result.exit =
        Number(
            last.current_price
        );


    result.roi =
        calculateROI(
            buyPrice,
            result.exit
        );


    result.status =
        result.roi >=0
            ? "OPEN_PROFIT"
            : "OPEN_LOSS";


    return result;

}



/* =========================================
   BACKTEST PROJECT
========================================= */


async function backtestProject(
    projectId,
    options={}
){


    const history =
        await getHistory(
            projectId
        );



    const trade =
        simulateTrade(
            history,
            options
        );



    if(!trade){

        return {

            success:false,

            message:
                "Not enough history"

        };

    }



    return {

        success:true,

        project_id:
            projectId,


        history_points:
            history.length,


        trade

    };


}



/* =========================================
   BACKTEST MULTIPLE PROJECTS
========================================= */


async function backtestProjects(
    projectIds=[]
){


    const results=[];



    for(
        const id of projectIds
    ){


        const result =
            await backtestProject(
                id
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



/* =========================================
   PERFORMANCE SUMMARY
========================================= */


function calculatePerformance(results=[]){


    let wins = 0;

    let losses = 0;


    let totalROI = 0;



    for(
        const r of results
    ){


        const trade =
            r.trade;



        if(!trade)
            continue;



        totalROI +=
            trade.roi;



        if(
            trade.status==="WIN"
        ){

            wins++;

        }



        if(
            trade.status==="LOSS"
        ){

            losses++;

        }

    }



    const total =
        wins + losses;



    return {


        total_trades:
            total,


        wins,


        losses,


        win_rate:

            total

            ?

            (
                wins /
                total
            )
            *
            100

            :

            0,


        average_roi:

            results.length

            ?

            totalROI /
            results.length

            :

            0


    };

}



/* =========================================
   EXPORTS
========================================= */


module.exports = {


    getHistory,


    simulateTrade,


    backtestProject,


    backtestProjects,


    calculatePerformance


};