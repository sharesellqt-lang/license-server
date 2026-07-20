// =========================================
// services/airdrop.project.history.service.js
// =========================================

"use strict";


const db = require("../db");



/* =========================================
   INIT TABLE
========================================= */

async function initTable(){


    const sql = `

    CREATE TABLE IF NOT EXISTS airdrop_project_history (

        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,


        project_id BIGINT UNSIGNED NOT NULL,


        token_symbol VARCHAR(50),


        current_price DECIMAL(30,12) DEFAULT 0,


        market_cap BIGINT DEFAULT 0,


        fdv BIGINT DEFAULT 0,


        total_score INT DEFAULT 0,


        risk_level VARCHAR(50),


        fair_buy_price DECIMAL(30,12) DEFAULT 0,


        fair_sell_price DECIMAL(30,12) DEFAULT 0,


        event_type VARCHAR(50) DEFAULT 'sync',


        snapshot JSON,


        created_at BIGINT NOT NULL,


        INDEX idx_project_id(project_id),

        INDEX idx_created_at(created_at)

    );

    `;


    await db.query(sql);

}



/* =========================================
   CREATE SNAPSHOT
========================================= */


async function createHistory(
    projectId,
    data = {},
    eventType="sync"
){


    const sql = `

    INSERT INTO airdrop_project_history

    (

        project_id,

        token_symbol,

        current_price,

        market_cap,

        fdv,

        total_score,

        risk_level,

        fair_buy_price,

        fair_sell_price,

        event_type,

        snapshot,

        created_at

    )

    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)

    `;



    const now =
        Date.now();



    const values = [


        projectId,


        data.token_symbol || "",


        Number(
            data.current_price || 0
        ),


        Number(
            data.market_cap || 0
        ),


        Number(
            data.fdv || 0
        ),


        Number(
            data.total_score || 0
        ),


        data.risk_level || "medium",


        Number(
            data.fair_buy_price || 0
        ),


        Number(
            data.fair_sell_price || 0
        ),


        eventType,


        JSON.stringify(data),


        now

    ];



    const [result] =
        await db.query(
            sql,
            values
        );



    return result.insertId;

}



/* =========================================
   GET HISTORY
========================================= */


async function getHistory(projectId, limit=100){


    const sql = `

        SELECT *

        FROM airdrop_project_history

        WHERE project_id=?

        ORDER BY created_at DESC

        LIMIT ?

    `;



    const [rows] =
        await db.query(
            sql,
            [
                projectId,
                Number(limit)
            ]
        );



    return rows || [];

}



/* =========================================
   GET PRICE CHART
========================================= */


async function getChart(projectId){


    const sql = `

        SELECT

            created_at,

            current_price,

            market_cap,

            fdv,

            total_score


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
   DELETE
========================================= */


async function deleteHistory(projectId){


    const sql = `

        DELETE FROM airdrop_project_history

        WHERE project_id=?

    `;



    const [result] =
        await db.query(
            sql,
            [
                projectId
            ]
        );



    return result.affectedRows;

}



/* =========================================
   EXPORT
========================================= */


module.exports = {


    initTable,


    createHistory,


    getHistory,


    getChart,


    deleteHistory


};