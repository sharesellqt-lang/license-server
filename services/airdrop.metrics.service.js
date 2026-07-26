// =========================================
// services/airdrop.metrics.service.js
// =========================================

"use strict";

const db = require("../db");
const coingecko = require("./collectors/coingecko.collector");
const gecko = require("./collectors/geckoterminal.collector");
const github =
    require("./collectors/github.collector");

const defillama =
    require("./collectors/defillama.collector");

const tokenterminal =
    require("./collectors/tokenterminal.collector");

const audit =
    require("./collectors/audit.collector");

const linkedin =
    require("./collectors/linkedin.collector");

const teamService =
    require("./airdrop.team.service");
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

            tvl:
    Number(data.tvl || 0),

tvl_growth_7d:
    Number(data.tvl_growth_7d || 0),

tvl_growth_30d:
    Number(data.tvl_growth_30d || 0),

protocol_fee:
    Number(data.protocol_fee || 0),

protocol_revenue:
    Number(data.protocol_revenue || 0),

revenue_growth_30d:
    Number(data.revenue_growth_30d || 0),

treasury:
    Number(data.treasury || 0),

cash_runway_months:
    Number(data.cash_runway_months || 0),

stablecoin_reserve:
    Number(data.stablecoin_reserve || 0),

token_buyback:
    Number(data.token_buyback || 0),

token_burn:
    Number(data.token_burn || 0),

holders:
    Number(data.holders || 0),

github_score:
    Number(data.github_score || 0),

github_stars:
    Number(data.github_stars || 0),

github_forks:
    Number(data.github_forks || 0),

github_recent_commits:
    Number(data.github_recent_commits || 0),

github_contributors:
    Number(data.github_contributors || 0),

audit_score:
    Number(data.audit_score || 0),

transactions_24h:
    Number(data.transactions_24h || 0),

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

        volume_24h: 0,
        liquidity: 0,
        price_change_24h: 0,

        tvl: 0,
        tvl_growth_7d: 0,
        tvl_growth_30d: 0,

        protocol_fee: 0,
        protocol_revenue: 0,
        revenue_growth_30d: 0,

        treasury: 0,
        cash_runway_months: 0,
        stablecoin_reserve: 0,

        token_buyback: 0,
        token_burn: 0,

        holders: 0,
        transactions_24h: 0,

        circulating_percent: 0,
        locked_percent: 0,
        inflation: 0,

        github_score: 0,
        github_stars: 0,
        github_forks: 0,
        github_watchers: 0,
        github_contributors: 0,
        github_recent_commits: 0,
        github_releases: 0,

        audit_score: 0,

        linkedin_score: 0,
        followers: 0,
        total_experience: 0,
        big_companies: 0,
        education_count: 0,

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

        risk_level: "medium",

        risk_score: 0,

        seed_roi: 0,
        private_roi: 0,
        public_roi: 0,

        recommendation: "",

        created_at: 0,
        updated_at: 0

    };

}
const METRIC_COLUMNS = [

    "project_id",

    "token_symbol",

    "current_price",

    "total_supply",
    "circulating_supply",
    "max_supply",

    "market_cap",
    "fdv",

    "volume_24h",
    "liquidity",
    "price_change_24h",

    "tvl",
    "tvl_growth_7d",
    "tvl_growth_30d",

    "protocol_fee",
    "protocol_revenue",
    "revenue_growth_30d",

    "treasury",
    "cash_runway_months",
    "stablecoin_reserve",

    "token_buyback",
    "token_burn",

    "holders",
    "transactions_24h",

    "seed_price",
    "private_price",
    "public_price",

    "fair_buy_price",
    "fair_sell_price",

    "ath_price",
    "atl_price",

    "funding_amount",

    "team_score",
    "investor_score",
    "partner_score",

    "tokenomics_score",
    "community_score",
    "development_score",
    "financial_score",
    "onchain_score",

    "total_score",

    "risk_level",

    "created_at",
    "updated_at",

    "circulating_percent",
    "locked_percent",
    "inflation",

    "risk_score",

    "seed_roi",
    "private_roi",
    "public_roi",

    "recommendation",

    "github_score",
    "github_stars",
    "github_forks",
    "github_watchers",
    "github_contributors",
    "github_recent_commits",
    "github_releases",

    "linkedin_score",
    "followers",
    "total_experience",
    "big_companies",
    "education_count"

];
/* =========================================
   GET
========================================= */

async function getMetrics(projectId){

const sql=`

SELECT *
FROM airdrop_project_metrics
WHERE project_id=?
LIMIT 1

`;

const [rows]=
await db.query(
sql,
[projectId]
);


return rows[0] || null;


}

/* =========================================
   GET ALL METRICS
========================================= */

async function getAllMetrics(userId){

    const sql = `
        SELECT
            m.*
        FROM airdrop_project_metrics m
        INNER JOIN airdrop_projects p
            ON p.id = m.project_id
        WHERE p.user_id=?
    `;

    const [rows] =
        await db.query(
            sql,
            [userId]
        );

    console.log(
        "METRICS LOADED:",
        rows.length
    );

    return rows || [];

}

/* =========================================
   CREATE
========================================= */

async function createMetrics(projectId, data = {}) {

    const now = Date.now();

    const metric = {

        ...defaultMetrics(),

        ...normalizeMetrics(data),

        project_id: projectId,

        created_at: now,

        updated_at: now

    };

    const columns =
        METRIC_COLUMNS;

    const placeholders =
        columns
            .map(() => "?")
            .join(",");

    const sql = `

INSERT INTO airdrop_project_metrics(

${columns.join(",")}

)

VALUES(

${placeholders}

)

`;

    const values =
        columns.map(

            c => metric[c] ?? null

        );

    console.log("COLUMN COUNT =", columns.length);
    console.log("PLACEHOLDER COUNT =", placeholders.split(",").length);
    console.log("VALUES COUNT =", values.length);

    try {

        const [result] =
            await db.query(
                sql,
                values
            );

        return result.insertId;

    }

    catch (err) {

        console.log("========== INSERT METRICS ERROR ==========");
        console.log(err.message);

        throw err;

    }

}

/* =========================================
   UPDATE
========================================= */

async function updateMetrics(projectId, data = {}) {

    const now = Date.now();

    const metric = {

        ...defaultMetrics(),

        ...normalizeMetrics(data),

        updated_at: now

    };

    delete metric.created_at;

    const columns =
    METRIC_COLUMNS.filter(

        c=>

        c!=="project_id"

        &&

        c!=="created_at"

    );

    const setClause =
        columns
            .map(c => `${c}=?`)
            .join(",");

    const sql = `

UPDATE
    airdrop_project_metrics

SET

${setClause}

WHERE
    project_id=?

`;

    const values = [

        ...columns.map(c => metric[c]),

        projectId

    ];

    const [result] =
        await db.query(
            sql,
            values
        );

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

    console.log(
        "========== SYNC COINGECKO =========="
    );


    console.log(
        "projectId =",
        projectId
    );


    console.log(
        "coinId =",
        coinId
    );


    if(!coinId){

        throw new Error(
            "Missing CoinGecko ID"
        );

    }



    const data =
        await coingecko.fetchById(
            coinId
        );



    console.log(
        "CoinGecko DATA:",
        data
    );



    await saveMetrics(

        projectId,

        data

    );



    console.log(
        "CoinGecko metrics saved."
    );


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

async function syncMarketData(project){

    console.log(
        "========== syncMarketData =========="
    );

    console.log(project);

    let marketData = {};

    const safeCollector = async (fn)=>{

    try{

        return await fn() || {};

    }

    catch(err){

        console.log(
            "Collector error:",
            err.message
        );

        return {};

    }

};

    /*
    ======================================
    GECKOTERMINAL
    ======================================
    */

    if(
        project.network &&
        project.contract_address
    ){

        try{

            marketData =
                await gecko.fetchToken(

                    project.network,

                    project.contract_address

                ) || {};

        }

        catch(err){

            console.log(
                "GeckoTerminal:",
                err.message
            );

        }

    }

    /*
    ======================================
    COINGECKO FALLBACK
    ======================================
    */

    if(

        Object.keys(
            marketData
        ).length === 0 &&

        project.coingecko_id

    ){

        try{

            marketData =
                await coingecko.fetchById(

                    project.coingecko_id

                ) || {};

        }

        catch(err){

            console.log(
                "CoinGecko:",
                err.message
            );

        }

    }

    /*
    ======================================
    OTHER COLLECTORS
    ======================================
    */
const [

    githubData,

    llamaData,

    terminalData,

    auditData

] = await Promise.all([


    safeCollector(()=>


        project.github_repo

        ?

        github.fetchRepository(
            project.github_repo
        )

        :

        {}


    ),


    safeCollector(()=>


        project.defillama_slug

        ?

        defillama.fetchProtocol(
            project.defillama_slug
        )

        :

        {}


    ),


    safeCollector(()=>


        project.token_terminal_id

        ?

        tokenterminal.fetchProject(
            project.token_terminal_id
        )

        :

        {}


    ),


    safeCollector(()=>


        audit.fetchAudit(project)


    )


]);

   
    /*
    ======================================
    TEAM LINKEDIN
    ======================================
    */

   

  const team =

    await teamService.getMembers(

        project.id

    );

let linkedinScore = 0;

let githubScore = 0;

for(const member of team){

    /*
    ===========================
    LINKEDIN
    ===========================
    */

    if(member.linkedin){

        try{

            const info =

                await linkedin.fetchProfile(

                    member.linkedin

                );

            linkedinScore +=

                info.linkedin_score || 0;

        }

        catch(err){

            console.log(

                "LinkedIn:",

                err.message

            );

        }

    }

    /*
    ===========================
    GITHUB
    ===========================
    */

    if(member.github){

        try{

            const repo =

                await github.fetchProfile(

                    member.github

                );

            githubScore +=

                repo.github_score || 0;

        }

        catch(err){

            console.log(

                "GitHub:",

                err.message

            );

        }

    }

}

  const memberCount =

    team.length || 1;

const teamScore =

    (

        linkedinScore +

        githubScore

    )

    /

    memberCount;

    /*
    ======================================
    MERGE
    ======================================
    */

const data = {

    ...marketData,

    ...githubData,

    ...llamaData,

    ...terminalData,

    ...auditData,

    github_score:

        githubData.github_score || 0,

    audit_score:

        auditData.audit_score || 0,

    tvl:

        llamaData.tvl || 0,

    tvl_growth_7d:

        llamaData.tvl_growth_7d || 0,

    tvl_growth_30d:

        llamaData.tvl_growth_30d || 0,

    treasury:

        terminalData.treasury || 0,

    protocol_fee:

        terminalData.protocol_fee || 0,

    protocol_revenue:

        terminalData.protocol_revenue || 0,

    revenue_growth_30d:

        terminalData.revenue_growth_30d || 0,

    cash_runway_months:

        terminalData.cash_runway_months || 0,

    stablecoin_reserve:

        terminalData.stablecoin_reserve || 0,

    token_buyback:

        terminalData.token_buyback || 0,

    token_burn:

        terminalData.token_burn || 0,

    team_score:

        teamScore

};

if (

    !data.market_cap &&
    !data.current_price &&
    !data.fdv &&
    !data.volume_24h

){

    console.log(
        "No market data collected, skip save."
    );

    return {};

}

console.log(
    "========== FINAL METRICS =========="
);

console.log(data);
console.log("========== FINAL METRICS ==========");

console.table({

market_cap:data.market_cap,

fdv:data.fdv,

volume_24h:data.volume_24h,

circulating_supply:data.circulating_supply,

holders:data.holders,

tvl:data.tvl,

github_score:data.github_score,

github_stars:data.github_stars

});

    await saveMetrics(

        project.id,

        data

    );

    console.log(
        "Metrics saved."
    );

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