"use strict";

const db = require("../db");
const enrichment =
    require("./airdrop.wallet.enrichment.service");

function buildProjectMap(projects) {

    const map = {};

    for (const p of projects) {

        map[p.token_symbol] = p;

    }

    return map;
}

/* =========================================
   GET PORTFOLIO
========================================= */

async function getPortfolio(userId) {

    const sql = `
        SELECT
            w.id,
            w.address,

            h.token_symbol,
            h.amount,
            h.avg_buy_price,
            h.last_price,
            h.pnl
        FROM airdrop_wallets w
        LEFT JOIN airdrop_wallet_holdings h
            ON w.id = h.wallet_id
        WHERE w.user_id = ?
    `;

    const [rows] = await db.query(sql, [userId]);

    const tokens = rows || [];

    /* =========================================
       LOAD PROJECT DATA
    ========================================= */

    const projectSql = `
        SELECT *
        FROM airdrop_project_metrics
    `;

    const [projects] = await db.query(projectSql);

    /* =========================================
       BUILD MAP
    ========================================= */

    const projectMap =
        buildProjectMap(projects);

    /* =========================================
       ENRICH TOKENS
    ========================================= */

    const enrichedTokens =
        enrichment.enrichWithProjectData(
            tokens,
            projectMap
        );

    return enrichedTokens;
}

function analyzePortfolio(rows) {

    let totalValue = 0;
    let totalCost = 0;
    let totalPnL = 0;

    const tokens = [];

    for (const r of rows) {

        const value =
            (r.amount || 0) * (r.last_price || 0);

        const cost =
            (r.amount || 0) * (r.avg_buy_price || 0);

        const pnl =
            value - cost;

        totalValue += value;
        totalCost += cost;
        totalPnL += pnl;

        tokens.push({

            token: r.token_symbol,

            amount: r.amount,

            value,
            cost,
            pnl,
            roi:
                cost ? (pnl / cost) * 100 : 0
        });

    }

    return {

        total_value: totalValue,
        total_cost: totalCost,
        total_pnl: totalPnL,

        roi:

            totalCost
                ? (totalPnL / totalCost) * 100
                : 0,

        tokens
    };
}

module.exports = {

    getPortfolio,
    analyzePortfolio
};

