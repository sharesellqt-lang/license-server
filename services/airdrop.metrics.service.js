// =========================================
// services/airdrop.metrics.service.js
// =========================================

"use strict";

const db = require("../db");
const coingecko = require("./collectors/coingecko.collector");
const gecko = require("./collectors/geckoterminal.collector");
function normalizeMetrics(data = {}) {

    return {

        token_symbol:
            String(data.token_symbol || "").trim(),

        current_price:
            Number(data.current_price || 0),

        total_supply:
            Number(data.total_supply || 0),

        circulating_supply:
            Number(data.circulating_supply || 0),

        max_supply:
            Number(data.max_supply || 0),

        market_cap:
            Number(data.market_cap || 0),

        fdv:
            Number(data.fdv || 0),

        volume_24h:
            Number(data.volume_24h || 0),

        liquidity:
            Number(data.liquidity || 0),

        price_change_24h:
            Number(data.price_change_24h || 0),

        seed_price:
            Number(data.seed_price || 0),

        private_price:
            Number(data.private_price || 0),

        public_price:
            Number(data.public_price || 0),

        fair_buy_price:
            Number(data.fair_buy_price || 0),

        fair_sell_price:
            Number(data.fair_sell_price || 0),

        ath_price:
            Number(data.ath_price || 0),

        atl_price:
            Number(data.atl_price || 0),

        funding_amount:
            Number(data.funding_amount || 0),

        team_score:
            Number(data.team_score || 0),

        investor_score:
            Number(data.investor_score || 0),

        partner_score:
            Number(data.partner_score || 0),

        tokenomics_score:
            Number(data.tokenomics_score || 0),

        community_score:
            Number(data.community_score || 0),

        development_score:
            Number(data.development_score || 0),

        financial_score:
            Number(data.financial_score || 0),

        onchain_score:
            Number(data.onchain_score || 0),

        total_score:
            Number(data.total_score || 0),

        risk_level:
            data.risk_level || "medium"

    };

}

/* =========================================
   DEFAULT METRICS
========================================= */

function defaultMetrics() {
    return {
        token_symbol: "",
        current_price: 0,
        total_supply: 0,
        circulating_supply: 0,
        max_supply: 0,
        market_cap: 0,
        fdv: 0,
        volume_24h:0,
        liquidity:0,
        price_change_24h:0,
        seed_price: 0,
        private_price: 0,
        public_price: 0,
        fair_buy_price: 0,
        fair_sell_price: 0,
        ath_price: 0,
        atl_price: 0,
        funding_amount: 0,
        team_score: 0,
        investor_score: 0,
        partner_score: 0,
        tokenomics_score: 0,
        community_score: 0,
        development_score: 0,
        financial_score: 0,
        onchain_score: 0,
        total_score: 0,
        risk_level: "medium"
    };
}


/* =========================================
   GET
========================================= */

async function getMetrics(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_metrics
        WHERE project_id=?
        LIMIT 1
    `;

    const [rows] = await db.query(sql, [projectId]);

    if (!rows.length) {

        return defaultMetrics();

    }

    return rows[0];

}

/* =========================================
   GET ALL METRICS
========================================= */

async function getAllMetrics(userId) {

    const sql = `
        SELECT
            m.*
        FROM airdrop_project_metrics m
        INNER JOIN airdrop_projects p
            ON p.id = m.project_id
        WHERE p.user_id = ?
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return rows || [];

}

/* =========================================
   CREATE
========================================= */

async function createMetrics(projectId, data = {}) {

const now = Date.now();

  const metric = {

    ...defaultMetrics(),

    ...normalizeMetrics(data)

};
    
    const sql = `
        INSERT INTO airdrop_project_metrics(

            project_id,

            token_symbol,

            current_price,

            total_supply,
            circulating_supply,
            max_supply,

            market_cap,
            fdv,
            volume_24h,
            liquidity,
            price_change_24h,
            seed_price,
            private_price,
            public_price,

            fair_buy_price,
            fair_sell_price,

            ath_price,
            atl_price,

            funding_amount,

            team_score,
            investor_score,
            partner_score,
            tokenomics_score,
            community_score,
            development_score,
            financial_score,
            onchain_score,

            total_score,

            risk_level,

            created_at,
            updated_at

        )

        VALUES(

            ?,?,?,?,?,?,
            ?,?,?,?,?,
            ?,?,?,
            ?,?,
            ?,?,
            ?,
            ?,?,?,?,?,?,?,?,
            ?,
            ?,
            ?,?

        )
    `;

    const values = [

        projectId,

        metric.token_symbol,

        metric.current_price,

        metric.total_supply,
        metric.circulating_supply,
        metric.max_supply,

        metric.market_cap,
        metric.fdv,

        metric.volume_24h,

        metric.liquidity,

        metric.price_change_24h,

        metric.seed_price,
        metric.private_price,
        metric.public_price,

        metric.fair_buy_price,
        metric.fair_sell_price,

        metric.ath_price,
        metric.atl_price,

        metric.funding_amount,

        metric.team_score,
        metric.investor_score,
        metric.partner_score,
        metric.tokenomics_score,
        metric.community_score,
        metric.development_score,
        metric.financial_score,
        metric.onchain_score,

        metric.total_score,

        metric.risk_level,

        now,
        now

    ];

    const [result] =
        await db.query(sql, values);

    return result.insertId;

}

/* =========================================
   UPDATE
========================================= */

async function updateMetrics(projectId, data = {}) {

   const metric = {

    ...defaultMetrics(),

    ...normalizeMetrics(data)

};

    const now = Date.now();

    const sql = `
        UPDATE airdrop_project_metrics
        SET

            token_symbol=?,

            current_price=?,

            total_supply=?,
            circulating_supply=?,
            max_supply=?,

            market_cap=?,
            fdv=?,

            volume_24h=?,

            liquidity=?,
            price_change_24h=?,

            seed_price=?,
            private_price=?,
            public_price=?,

            fair_buy_price=?,
            fair_sell_price=?,

            ath_price=?,
            atl_price=?,

            funding_amount=?,

            team_score=?,
            investor_score=?,
            partner_score=?,
            tokenomics_score=?,
            community_score=?,
            development_score=?,
            financial_score=?,
            onchain_score=?,

            total_score=?,

            risk_level=?,

            updated_at=?

        WHERE project_id=?
    `;
const values = [

    metric.token_symbol,

    metric.current_price,

    metric.total_supply,
    metric.circulating_supply,
    metric.max_supply,

    metric.market_cap,
    metric.fdv,

    metric.volume_24h,

    metric.liquidity,
    metric.price_change_24h,

    metric.seed_price,
    metric.private_price,
    metric.public_price,

    metric.fair_buy_price,
    metric.fair_sell_price,

    metric.ath_price,
    metric.atl_price,

    metric.funding_amount,

    metric.team_score,
    metric.investor_score,
    metric.partner_score,
    metric.tokenomics_score,
    metric.community_score,
    metric.development_score,
    metric.financial_score,
    metric.onchain_score,

    metric.total_score,

    metric.risk_level,

    now,

    projectId

];

    const [result] =
        await db.query(sql, values);

    return result.affectedRows > 0;

}

/* =========================================
   UPSERT
========================================= */

async function saveMetrics(projectId, data = {}) {

    console.log("========== SAVE METRICS ==========");
    console.log("projectId =", projectId);
    console.log(data);

    const current =
        await getMetrics(projectId);

    console.log("current =", current);

    if (!current || !current.id) {

        console.log("Create metrics");

        await createMetrics(
            projectId,
            data
        );

        return true;

    }

    console.log("Update metrics");

    return await updateMetrics(
        projectId,
        data
    );

}

/* =========================================
   DELETE
========================================= */

async function deleteMetrics(projectId) {

    const sql = `
        DELETE
        FROM airdrop_project_metrics
        WHERE project_id=?
    `;

    const [result] =
        await db.query(sql, [projectId]);

    return result.affectedRows > 0;

}

async function syncCoinGecko(
    projectId,
    coinId
){
    console.log("========== SYNC COINGECKO ==========");
console.log("projectId =", projectId);
console.log("coinId =", coinId);

    if(!coinId){

        throw new Error(
            "Missing CoinGecko ID"
        );

    }


    const data =
        await coingecko.fetchById(
            coinId
        );
console.log("CoinGecko DATA:", data);

    await saveMetrics(
        projectId,
        data
    );
console.log("Metrics saved.");

    return data;

}

async function syncGeckoTerminal(
    projectId,
    coinId
){
    console.log("========== SYNC COINGECKO ==========");
console.log("projectId =", projectId);
console.log("coinId =", coinId);

    if(!coinId){

        throw new Error(
            "Missing CoinGecko ID"
        );

    }


    const data =
        await coingecko.fetchById(
            coinId
        );
console.log("CoinGecko DATA:", data);

    await saveMetrics(
        projectId,
        data
    );
console.log("Metrics saved.");

    return data;

}

async function syncMarketData(project) {

    let data = null;

    /*
    =====================================
    GECKOTERMINAL
    =====================================
    */

    if (

        project.network &&
        project.contract_address

    ) {

        console.log("Using GeckoTerminal");

        data =
            await gecko.fetchToken(

                project.network,

                project.contract_address

            );

    }

    /*
    =====================================
    COINGECKO
    =====================================
    */

    else if (

        project.coingecko_id

    ) {

        console.log("Using CoinGecko");

        data =
            await coingecko.fetchById(

                project.coingecko_id

            );

    }

    /*
    =====================================
    NO SOURCE
    =====================================
    */

    else {

        throw new Error(

            "Missing market source"

        );

    }

    /*
    =====================================
    SAVE
    =====================================
    */

    await saveMetrics(

        project.id,

        data

    );

    console.log("Metrics saved");

    return data;

}
/* =========================================
   EXPORT
========================================= */

module.exports = {

    defaultMetrics,

    normalizeMetrics,

    getMetrics,

    getAllMetrics,

    createMetrics,

    updateMetrics,

    saveMetrics,

    deleteMetrics,

    syncCoinGecko,

    syncMarketData

};