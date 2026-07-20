"use strict";

const db = require("../../db");

/* =========================================
   STORE RESULT
========================================= */

async function storeResult(data) {

    const pnl =
        data.exit_price - data.entry_price;

    const result =
        pnl > 0 ? "win" :
        pnl < 0 ? "loss" :
        "neutral";

    const sql = `
        INSERT INTO airdrop_ai_performance (
            project_id,
            user_id,
            ai_action,
            ai_score,
            ai_strategy,
            entry_price,
            exit_price,
            pnl,
            result,
            created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `;

    await db.query(sql, [

        data.project_id,
        data.user_id,
        data.ai_action,
        data.ai_score,
        JSON.stringify(data.ai_strategy),
        data.entry_price,
        data.exit_price,
        pnl,
        result,
        Date.now()
    ]);
}

module.exports = {
    storeResult
};