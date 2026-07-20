"use strict";


const db = require("../../db");


const backtest =
    require("../airdrop.backtest.service");



/* =========================================
   ANALYZE PERFORMANCE FROM DATABASE
========================================= */

async function analyzePerformance(userId) {


    const sql = `

        SELECT *

        FROM airdrop_ai_performance

        WHERE user_id = ?

    `;



    const [rows] =
        await db.query(
            sql,
            [
                userId
            ]
        );



    let win = 0;

    let loss = 0;

    let total = rows.length;


    let avgPnl = 0;



    for(
        const r of rows
    ){


        avgPnl +=
            Number(
                r.pnl || 0
            );



        if(
            r.result === "win"
        ){

            win++;

        }



        if(
            r.result === "loss"
        ){

            loss++;

        }


    }



    const winRate =

        total

        ?

        (
            win /
            total
        )
        *
        100

        :

        0;



    avgPnl =

        total

        ?

        avgPnl /
        total

        :

        0;



    return {


        total_trades:
            total,


        win_rate:
            Number(
                winRate.toFixed(2)
            ),


        avg_pnl:
            Number(
                avgPnl.toFixed(2)
            ),


        loss_rate:

            Number(
                (
                    100 -
                    winRate
                )
                .toFixed(2)
            )

    };


}





/* =========================================
   RUN BACKTEST LEARNING
========================================= */

async function learnFromBacktest(
    projectIds=[]
){


    const result =
        await backtest.backtestProjects(
            projectIds
        );



    const performance =
        backtest.calculatePerformance(
            result.results
        );



    return performance;


}




/* =========================================
   EXPORTS
========================================= */


module.exports = {


    analyzePerformance,


    learnFromBacktest


};