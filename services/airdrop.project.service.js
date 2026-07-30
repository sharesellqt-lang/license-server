// =========================================
// services/airdrop.project.service.js (FIXED)
// =========================================

"use strict";

const db = require("../db");
const metricsService =
require("./airdrop.metrics.service");
const coinSearch =
require("./collectors/coingecko.search.collector");
const analysisService =
    require("./airdrop.analysis.service");

/* =========================================
   INIT TABLE (SAFE AUTO MIGRATION)
========================================= */

async function initTable() {

    const sql = `
        CREATE TABLE IF NOT EXISTS airdrop_projects (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

            user_id BIGINT UNSIGNED NOT NULL,

            name VARCHAR(255) NOT NULL,
            url TEXT,
            wallet VARCHAR(255) DEFAULT NULL,

            network VARCHAR(50) DEFAULT NULL,

            contract_address VARCHAR(255) DEFAULT NULL,

            coingecko_id VARCHAR(100) DEFAULT NULL,

            start_date DATE NULL,
            end_date DATE NULL,

            tasks TEXT,

            interactions INT DEFAULT 0,

            status ENUM('on','off') DEFAULT 'on',

            result ENUM('pending','eligible','not-eligible') DEFAULT 'pending',

            fees VARCHAR(50) DEFAULT NULL,

            score INT DEFAULT 0,

            source VARCHAR(100) DEFAULT NULL,

            created_at BIGINT NOT NULL,
            updated_at BIGINT NULL,

            INDEX idx_user_id (user_id),
            INDEX idx_status (status),
            INDEX idx_result (result),
            INDEX idx_score (score),
            INDEX idx_created_at (created_at)
        );
    `;

    await db.query(sql);
}

/* =========================================
   VALIDATION
========================================= */

function validateProject(data) {

    if (!data) {
        throw new Error("Invalid project data");
    }

    if (!data.name || !String(data.name).trim()) {
        throw new Error("Project name is required");
    }

    return true;
}

/* =========================================
   NORMALIZE INPUT
========================================= */

function normalizeProjectInput(data = {}) {

    return {

        name:
            String(data.name || "").trim(),

        url:
            String(data.url || "").trim(),

        wallet:
            String(data.wallet || "").trim(),

        network:
            String(data.network || "").trim(),

        contract_address:
            String(
                data.contract_address || ""
            ).trim(),

        coingecko_id:
            String(
                data.coingecko_id || ""
            ).trim(),

        start_date:
            data.start_date ??
            data.startDate ??
            null,

        end_date:
            data.end_date ??
            data.endDate ??
            null,

        tasks:
            String(data.tasks || "").trim(),

        interactions:
            Number(data.interactions || 0),

        status:
            data.status || "on",

        result:
            data.result || "pending",

        fees:
            data.fees || null,

        source:
            data.source || "manual",

        watchlist:
            Number(data.watchlist || 0),

        difficulty:
            data.difficulty || "medium",

        expected_reward:
            Number(data.expected_reward || 0),

        risk:
            Number(data.risk || 0),

        ai_confidence:
            Number(data.ai_confidence || 0),

        notes:
            data.notes || null,

        tags:
            data.tags || null

    };

}

/* =========================================
   CREATE PROJECT
========================================= */

async function createProject(userId, data) {

validateProject(data);

const p = normalizeProjectInput(data);


/*
=====================================
AUTO FIND COINGECKO ID
=====================================
*/

if (

    !p.coingecko_id &&

    p.name

){

    try{


        const coins =
            await coinSearch.searchCoin(

                p.name

            );


        if (

            coins &&

            coins.length

        ){

            /*
            ưu tiên coin đầu tiên
            */

            p.coingecko_id =
                coins[0].id;


            console.log(
                "AUTO COINGECKO ID:",
                p.coingecko_id
            );


        }


    }

    catch(err){


        console.log(

            "Search CoinGecko:",

            err.message

        );


    }

}

    const sql = `
        INSERT INTO airdrop_projects (
            user_id,
            name,
            url,
            wallet,
            network,
            contract_address,
            start_date,
            end_date,
            tasks,
            interactions,
            status,
            result,
            fees,
            source,
            coingecko_id,
            created_at,
            updated_at
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    const now = Date.now();

    const values = [
        userId,
        p.name,
        p.url,
        p.wallet,
        p.network,
        p.contract_address,
        p.start_date,
        p.end_date,
        p.tasks,
        p.interactions,
        p.status,
        p.result,
        p.fees,
        p.source,
        p.coingecko_id,
        now,
        now
    ];
console.log(values.length);
    const [result] =
    await db.query(
        sql,
        values
    );

if (!result.insertId) {

    return {

        success: false,

        message: "Insert failed"

    };

}

    const projectId = result.insertId;

/*
-------------------------------------
SYNC MARKET
-------------------------------------
*/

console.log("========== BEFORE SYNC ==========");
console.log("network =", p.network);
console.log("contract =", p.contract_address);
console.log("coingecko =", p.coingecko_id);

try {

    const hasGeckoTerminal =
        Boolean(
            p.network &&
            p.contract_address
        );


    const hasCoinGecko =
        typeof p.coingecko_id === "string" &&
        p.coingecko_id.trim().length > 0;



    if(
        hasGeckoTerminal ||
        hasCoinGecko
    ){

        console.log(
            "CALL syncMarketData"
        );


        const marketData =
            await metricsService.syncMarketData({

                id: projectId,

                name:p.name,

                network:p.network,

                contract_address:p.contract_address,

                coingecko_id:p.coingecko_id

            });


        console.log(
            "MARKET DATA:",
            marketData
        );


    }
    else {

        console.log(
            "Skip market sync"
        );

    }


}
catch(err){

    console.log(
        "========== SYNC MARKET ERROR =========="
    );

    console.log(
        err.message
    );

}

/*
-------------------------------------
ANALYSIS
-------------------------------------
*/

try{
console.log("CALL analyzeProject");
await new Promise(
    resolve => setTimeout(resolve,1000)
);

    await analysisService.analyzeProject(

        userId,

        projectId

    );
console.log("AFTER analyzeProject");
}
catch(err){

    console.error("Analysis ERROR:");
    console.error(err);

}
  

    return {
        success: true,
        data: {
            id: projectId,
            user_id: userId,
            ...p,
            created_at: now,
            updated_at: now
        }
    };
}

/* =========================================
   UPDATE PROJECT
========================================= */

async function updateProject(userId, id, data) {

    validateProject(data);

    const p = normalizeProjectInput(data);

   const sql = `
UPDATE airdrop_projects
SET
    name=?,
    url=?,
    wallet=?,

    network=?,
    contract_address=?,

    start_date=?,
    end_date=?,

    tasks=?,
    interactions=?,

    status=?,
    result=?,

    fees=?,

    watchlist=?,

    source=?,

    difficulty=?,
    expected_reward=?,
    risk=?,
    ai_confidence=?,

    notes=?,
    tags=?,

    updated_at=?

WHERE id=? AND user_id=?
`;

    const now = Date.now();

const values = [

    p.name,
    p.url,
    p.wallet,

    p.network,
    p.contract_address,

    p.start_date,
    p.end_date,

    p.tasks,
    p.interactions,

    p.status,
    p.result,

    p.fees,

    p.watchlist,

    p.source,

    p.difficulty,
    p.expected_reward,
    p.risk,
    p.ai_confidence,

    p.notes,
    p.tags,

    now,

    id,
    userId

];

    const [result] = await db.query(sql, values);

    // ✅ FIX QUAN TRỌNG
    return result.affectedRows > 0;
}

/* =========================================
   DELETE PROJECT
========================================= */

async function deleteProject(userId, id) {

    const sql = `
        DELETE FROM airdrop_projects
        WHERE id=? AND user_id=?
    `;

    const [result] = await db.query(sql, [id, userId]);

    if (!result.affectedRows) {
        return {
            success: false,
            deleted: false
        };
    }

    return {
        success: true,
        deleted: true
    };
}

async function updateWatchlist(
    projectId,
    watchlist
){

    const value =
        Number(watchlist) === 1
            ? 1
            : 0;


    const [result] =
        await db.query(
            `
            UPDATE airdrop_projects
            SET watchlist=?
            WHERE id=?
            `,
            [
                value,
                projectId
            ]
        );


    return {
        success:true,
        watchlist:value,
        affectedRows:
            result.affectedRows
    };

}
/* =========================================
   GET PROJECTS BY USER (LIST)
========================================= */

async function getProjectsByUser(userId) {

    const sql = `
        SELECT

            p.*,

            m.current_price,
            m.market_cap,
            m.fdv,
            m.volume_24h,
            m.liquidity,

            m.total_score,
            m.risk_level,

            m.investment_score,
            m.investment_rating,
            m.investment_action

        FROM airdrop_projects p

        LEFT JOIN airdrop_project_metrics m

            ON p.id = m.project_id

        WHERE p.user_id = ?

        ORDER BY p.created_at DESC
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return {

        success: true,

        data: rows || [],

        count: rows?.length || 0

    };

}

/* =========================================
   SEARCH PROJECTS
========================================= */

async function searchProjects(userId, keyword = "") {

    keyword = `%${String(keyword).trim()}%`;

    const sql = `
        SELECT *
        FROM airdrop_projects
        WHERE user_id=?
        AND (
            name LIKE ?
            OR url LIKE ?
            OR tasks LIKE ?
        )
        ORDER BY created_at DESC
    `;

    const [rows] = await db.query(sql, [
        userId,
        keyword,
        keyword,
        keyword
    ]);

    return {
        success: true,
        data: rows || []
    };
}

/* =========================================
   UPSERT PROJECT
========================================= */

async function upsertProject(userId, id, data) {

    if (!id) {
        return createProject(userId, data);
    }

    const existing = await getProjectById(userId, id);

    if (!existing) {
        return createProject(userId, data);
    }

    return updateProject(userId, id, data);
}

/* =========================================
   EXPORT JSON
========================================= */

async function exportJson(userId) {

    const projects = await getProjectsByUser(userId);

    return JSON.stringify(projects.data || [], null, 2);
}

/* =========================================
   EXPORT CSV
========================================= */

async function exportCsv(userId) {

    const projects = await getProjectsByUser(userId);

    const headers = [
        "id",
        "name",
        "url",
        "start_date",
        "end_date",
        "tasks",
        "interactions",
        "status",
        "result",
        "fees",
        "score",
        "source",
        "created_at"
    ];

    const rows = [headers];

    for (const p of projects.data || []) {

        rows.push([
            p.id,
            p.name,
            p.url,
            p.start_date,
            p.end_date,
            p.tasks,
            p.interactions,
            p.status,
            p.result,
            p.fees,
            p.score,
            p.source,
            p.created_at
        ]);
    }

    return rows
        .map(row =>
            row
                .map(v =>
                    `"${String(v ?? "").replace(/"/g, '""')}"`
                )
                .join(",")
        )
        .join("\n");
}

/* =========================================
   STATISTICS
========================================= */

async function getStatistics(userId) {

    const sql = `
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN result='eligible' THEN 1 ELSE 0 END) as eligible,
            SUM(CASE WHEN result='not-eligible' THEN 1 ELSE 0 END) as not_eligible,
            SUM(CASE WHEN result='pending' THEN 1 ELSE 0 END) as pending,
            AVG(score) as avg_score
        FROM airdrop_projects
        WHERE user_id=?
    `;

    const [rows] = await db.query(sql, [userId]);

    return rows[0] || {
        total: 0,
        eligible: 0,
        not_eligible: 0,
        pending: 0,
        avg_score: 0
    };
}

/* =========================================
   GET PROJECT BY ID
========================================= */

async function getProjectById(
    userId,
    projectId
) {

    const sql = `
        SELECT *
        FROM airdrop_projects
        WHERE
            id = ?
        AND
            user_id = ?
        LIMIT 1
    `;

    const [rows] =
        await db.query(sql, [

            Number(projectId),

            Number(userId)

        ]);

    return rows[0] || null;

}

async function getProjects(userId){

    const [rows] =
        await db.query(
            `
            SELECT *
            FROM airdrop_projects
            WHERE user_id = ?
            ORDER BY created_at DESC
            `,
            [
                userId
            ]
        );

    return rows;

}

async function updateAnalysisScore(
    id,
    score,
    risk
){

    await db.query(
        `
        UPDATE airdrop_projects
        SET
            score=?,
            risk=?,
            updated_at=?
        WHERE id=?
        `,
        [
            score,
            risk,
            Date.now(),
            id
        ]
    );

}
/* =========================================
   EXPORTS
========================================= */

module.exports = {

    initTable,
    validateProject,
    normalizeProjectInput,
    createProject,
    updateProject,
    deleteProject,
    updateWatchlist,
    getProjectById,
    getProjectsByUser,
    getProjects,
    searchProjects,
    upsertProject,
    exportJson,
    exportCsv,
    getStatistics,
    updateAnalysisScore
};