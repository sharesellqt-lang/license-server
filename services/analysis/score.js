// =========================================
// services/analysis/score.js
// =========================================

"use strict";

/* =========================================
   CONFIG
========================================= */

const SCORE = {

    TEAM: 15,

    INVESTOR: 15,

    PARTNER: 10,

    TOKENOMICS: 20,

    FINANCIAL: 10,

    COMMUNITY: 10,

    DEVELOPMENT: 10,

    ONCHAIN: 10

};

/*
======================================================
TEAM (15)

- Founder
- Core team
- LinkedIn
- GitHub
- Previous startup
- Previous unicorn
- Previous exit
- Advisor
======================================================

INVESTOR (15)

- Tier 1 VC
- Tier 2 VC
- Funding amount
- Number of investors
- Strategic investors
======================================================

PARTNER (10)

- Official partners
- Layer1
- Layer2
- Oracle
- Exchange
- Infrastructure
======================================================

TOKENOMICS (20)

- FDV
- Market Cap
- Circulating
- Locked
- Inflation
- Vesting
- Buyback
- Burn
======================================================

FINANCIAL (10)

- TVL
- TVL Growth
- Revenue
- Revenue Growth
- Protocol Fee
- Treasury
- Cash Runway
- Stablecoin Reserve
======================================================

COMMUNITY (10)

- Twitter
- Telegram
- Discord
- Website
- Active users
======================================================

DEVELOPMENT (10)

- GitHub Stars
- Forks
- Contributors
- Recent Commits
- Audit
======================================================

ONCHAIN (10)

- Holders
- Transactions
- Active Wallets
- Whale Distribution
- Liquidity
- Volume
======================================================
*/

/* =========================================
   HELPERS
========================================= */

/* =========================================
   CLAMP
========================================= */

function clamp(
    value,
    min = 0,
    max = 100
){

    value =
        Number(value);

    if(
        !Number.isFinite(value)
    ){

        value = 0;

    }

    if(
        value < min
    ){

        return min;

    }

    if(
        value > max
    ){

        return max;

    }

    return value;

}

/* =========================================
   NORMALIZE
========================================= */

function normalize(
    value,
    max
){

    value =
        Number(value);

    max =
        Number(max);

    if(
        !Number.isFinite(value)
    ){

        value = 0;

    }

    if(
        !Number.isFinite(max) ||
        max <= 0
    ){

        return 0;

    }

    return clamp(

        value,

        0,

        max

    );

}


/* =========================================
   TEAM
========================================= */

function calculateTeam(data = {}) {

    let score = 0;

    /*
    ======================================
    TEAM SIZE
    ======================================
    */

    const members =

        Number(data.team_members || 0);

    if (members >= 15) {

        score += 2;

    }
    else if (members >= 8) {

        score += 1;

    }

    /*
    ======================================
    FOUNDERS
    ======================================
    */

    const founders =

        Number(data.founders || 0);

    if (founders >= 2) {

        score += 2;

    }
    else if (founders === 1) {

        score += 1;

    }

    /*
    ======================================
    LINKEDIN
    ======================================
    */

    const linkedin =

        Number(data.linkedin_score || 0);

    if (linkedin >= 90) {

        score += 3;

    }
    else if (linkedin >= 70) {

        score += 2;

    }
    else if (linkedin >= 50) {

        score += 1;

    }

    /*
    ======================================
    GITHUB
    ======================================
    */

    const github =

        Number(data.github_score || 0);

    if (github >= 90) {

        score += 2;

    }
    else if (github >= 70) {

        score += 1;

    }

    /*
    ======================================
    ADVISORS
    ======================================
    */

    const advisors =

        Number(data.advisors || 0);

    if (advisors >= 5) {

        score += 2;

    }
    else if (advisors >= 2) {

        score += 1;

    }

    /*
    ======================================
    PREVIOUS EXPERIENCE
    ======================================
    */

    if (data.previous_exit) {

        score += 2;

    }

    if (data.previous_unicorn) {

        score += 1;

    }

    if (data.previous_startup) {

        score += 1;

    }

    return normalize(

        score,

        SCORE.TEAM

    );

}

/* =========================================
   INVESTOR
========================================= */

function calculateInvestor(data = {}) {

    let score = 0;


    const investors =

        Array.isArray(data.investors)

            ? data.investors

            : [];


    const funding =

        Number(
            data.funding_amount || 0
        );


    /*
    ======================================
    NUMBER OF INVESTORS
    ======================================
    */

    const count =
        investors.length;


    if(count >= 10){

        score += 3;

    }
    else if(count >= 5){

        score += 2;

    }
    else if(count >= 2){

        score += 1;

    }


    /*
    ======================================
    INVESTOR QUALITY
    ======================================
    */


    let tier1 = 0;

    let tier2 = 0;


    for(const investor of investors){


        if(
            investor.tier === "tier1" ||
            investor.tier === "A"
        ){

            tier1++;

        }


        else if(
            investor.tier === "tier2" ||
            investor.tier === "B"
        ){

            tier2++;

        }

    }



    if(tier1 >= 5){

        score += 7;

    }

    else if(tier1 >= 2){

        score += 5;

    }

    else if(tier2 >= 3){

        score += 3;

    }



    /*
    ======================================
    FUNDING
    ======================================
    */


    if(funding >= 100000000){

        score += 5;

    }

    else if(funding >= 50000000){

        score += 3;

    }

    else if(funding >= 10000000){

        score += 1;

    }



    /*
    ======================================
    STRATEGIC INVESTOR
    ======================================
    */


    const strategic =

        investors.filter(

            x => x.strategic === true

        ).length;


    if(strategic >= 3){

        score += 2;

    }

    else if(strategic >= 1){

        score += 1;

    }



    return normalize(

        score,

        SCORE.INVESTOR

    );

}

/* =========================================
   PARTNER
========================================= */

function calculatePartner(data = {}) {

    let score = 0;


    const partners =

        Array.isArray(data.partners)

            ? data.partners

            : [];



    /*
    ======================================
    NUMBER OF PARTNERS
    ======================================
    */

    const count =
        partners.length;


    if(count >= 20){

        score += 2;

    }
    else if(count >= 10){

        score += 1;

    }



    /*
    ======================================
    PARTNER QUALITY
    ======================================
    */


    let tier1 = 0;

    let tier2 = 0;


    let strategic = 0;

    let infrastructure = 0;



    for(const partner of partners){


        /*
        Tier
        */

        if(

            partner.tier === "tier1" ||

            partner.tier === "A"

        ){

            tier1++;

        }


        else if(

            partner.tier === "tier2" ||

            partner.tier === "B"

        ){

            tier2++;

        }



        /*
        Strategic
        */

        if(
            partner.strategic === true
        ){

            strategic++;

        }



        /*
        Infrastructure

        Example:

        Chainlink
        AWS
        Google Cloud
        Alchemy
        LayerZero

        */

        if(

            partner.type ===
            "infrastructure"

        ){

            infrastructure++;

        }


    }



    /*
    ======================================
    TIER 1 PARTNER
    ======================================
    */


    if(tier1 >= 5){

        score += 4;

    }

    else if(tier1 >= 2){

        score += 3;

    }

    else if(tier1 >= 1){

        score += 2;

    }



    /*
    ======================================
    TIER 2
    ======================================
    */


    if(tier2 >= 5){

        score += 2;

    }

    else if(tier2 >= 2){

        score += 1;

    }



    /*
    ======================================
    STRATEGIC
    ======================================
    */


    if(strategic >= 3){

        score += 2;

    }

    else if(strategic >= 1){

        score += 1;

    }



    /*
    ======================================
    INFRASTRUCTURE
    ======================================
    */


    if(infrastructure >= 3){

        score += 2;

    }

    else if(infrastructure >= 1){

        score += 1;

    }



    return normalize(

        score,

        SCORE.PARTNER

    );

}

/* =========================================
   TOKENOMICS
========================================= */

function calculateTokenomics(data = {}) {

    let score = 0;


    /*
    ======================================
    SUPPLY DISTRIBUTION
    ======================================
    */

    const circulatingPercent =

        Number(
            data.circulating_percent || 0
        );


    const lockedPercent =

        Number(
            data.locked_percent || 0
        );



    if(circulatingPercent >= 70){

        score += 4;

    }
    else if(circulatingPercent >= 50){

        score += 3;

    }
    else if(circulatingPercent >= 30){

        score += 1;

    }



    /*
    ======================================
    UNLOCK PRESSURE
    ======================================
    */


    const unlock30d =

        Number(
            data.unlock_30d_percent || 0
        );


    if(unlock30d <= 5){

        score += 3;

    }

    else if(unlock30d <= 15){

        score += 1;

    }

    else if(unlock30d >= 30){

        score -= 3;

    }



    /*
    ======================================
    FDV / MARKET CAP
    ======================================
    */


    const fdv =

        Number(data.fdv || 0);


    const marketCap =

        Number(data.market_cap || 0);



    if(
        fdv > 0 &&
        marketCap > 0
    ){

        const ratio =
            fdv / marketCap;


        if(ratio <= 1.5){

            score += 4;

        }

        else if(ratio <= 3){

            score += 3;

        }

        else if(ratio <= 5){

            score += 1;

        }

        else {

            score -= 2;

        }

    }



    /*
    ======================================
    INFLATION
    ======================================
    */


    const inflation =

        Number(
            data.inflation || 0
        );



    if(inflation <= 5){

        score += 3;

    }

    else if(inflation <= 20){

        score += 1;

    }

    else if(inflation >= 50){

        score -= 3;

    }



    /*
    ======================================
    TOKEN UTILITY
    ======================================
    */


    if(
        data.token_utility === true
    ){

        score += 2;

    }



    /*
    ======================================
    BURN MECHANISM
    ======================================
    */


    if(
        Number(data.token_burn || 0) > 0
    ){

        score += 1;

    }



    /*
    ======================================
    BUYBACK
    ======================================
    */


    if(
        Number(data.token_buyback || 0) > 0
    ){

        score += 1;

    }



    /*
    ======================================
    HOLDER DISTRIBUTION
    ======================================
    */


    const whalePercent =

        Number(
            data.whale_percent || 0
        );


    if(whalePercent <= 20){

        score += 2;

    }

    else if(whalePercent >= 50){

        score -= 3;

    }



    /*
    ======================================
    LIMIT
    ======================================
    */


    return normalize(

        score,

        SCORE.TOKENOMICS

    );

}

/* =========================================
   FINANCIAL
========================================= */

function calculateFinancial(data = {}) {


    let score = 0;



    const marketCap =

        Number(
            data.market_cap || 0
        );


    const volume =

        Number(
            data.volume_24h || 0
        );


    const tvl =

        Number(
            data.tvl || 0
        );


    const tvlGrowth =

        Number(
            data.tvl_growth_30d || 0
        );


    const revenue =

        Number(
            data.protocol_revenue || 
            data.revenue ||
            0
        );


    const fee =

        Number(
            data.protocol_fee || 0
        );


    const revenueGrowth =

        Number(
            data.revenue_growth_30d || 0
        );


    const treasury =

        Number(
            data.treasury || 0
        );


    const runway =

        Number(
            data.cash_runway_months || 0
        );


    const stableReserve =

        Number(
            data.stablecoin_reserve || 0
        );



    /*
    ======================================
       MARKET LIQUIDITY
    ======================================
    */


    if(marketCap >= 1000000000){

        score += 2;

    }

    else if(marketCap >= 100000000){

        score += 1;

    }



    if(volume >= 10000000){

        score += 1;

    }

    else if(volume >= 1000000){

        score += 0.5;

    }



    /*
    ======================================
       TVL
    ======================================
    */


    if(tvl >= 1000000000){

        score += 2;

    }

    else if(tvl >= 100000000){

        score += 1;

    }

    else if(tvl >= 10000000){

        score += 0.5;

    }



    /*
    ======================================
       TVL GROWTH
    ======================================
    */


    if(tvlGrowth >= 50){

        score += 1;

    }

    else if(tvlGrowth >= 10){

        score += 0.5;

    }

    else if(tvlGrowth < -30){

        score -= 1;

    }



    /*
    ======================================
       REVENUE
    ======================================
    */


    if(revenue >= 10000000){

        score += 2;

    }

    else if(revenue >= 1000000){

        score += 1;

    }

    else if(revenue > 0){

        score += 0.5;

    }



    /*
    ======================================
       PROTOCOL FEE
    ======================================
    */


    if(fee >= 5000000){

        score += 1;

    }

    else if(fee >= 500000){

        score += 0.5;

    }



    /*
    ======================================
       REVENUE GROWTH
    ======================================
    */


    if(revenueGrowth >= 50){

        score += 1;

    }

    else if(revenueGrowth >= 10){

        score += 0.5;

    }



    /*
    ======================================
       TREASURY
    ======================================
    */


    if(treasury >= 50000000){

        score += 1;

    }

    else if(treasury >= 10000000){

        score += 0.5;

    }



    /*
    ======================================
       CASH RUNWAY
    ======================================
    */


    if(runway >= 24){

        score += 1;

    }

    else if(runway >= 12){

        score += 0.5;

    }

    else if(runway > 0 && runway < 6){

        score -= 1;

    }



    /*
    ======================================
       STABLECOIN RESERVE
    ======================================
    */


    if(stableReserve >= 10000000){

        score += 1;

    }



    /*
    ======================================
       LIMIT
    ======================================
    */


    return normalize(

        score,

        SCORE.FINANCIAL

    );

}

/* =========================================
   COMMUNITY
========================================= */

function calculateCommunity(data = {}) {

    let score = 0;


    const twitterFollowers =

        Number(
            data.twitter_followers || 0
        );


    const telegramMembers =

        Number(
            data.telegram_members || 0
        );


    const discordMembers =

        Number(
            data.discord_members || 0
        );


    const engagementRate =

        Number(
            data.engagement_rate || 0
        );


    const communityGrowth =

        Number(
            data.community_growth_30d || 0
        );


    const activeUsers =

        Number(
            data.active_users || 0
        );



    /*
    ======================================
       TWITTER / X
    ======================================
    */


    if(twitterFollowers >= 1000000){

        score += 3;

    }
    else if(twitterFollowers >= 100000){

        score += 2;

    }
    else if(twitterFollowers >= 10000){

        score += 1;

    }



    /*
    ======================================
       TELEGRAM
    ======================================
    */


    if(telegramMembers >= 500000){

        score += 2;

    }

    else if(telegramMembers >= 100000){

        score += 1;

    }



    /*
    ======================================
       DISCORD
    ======================================
    */


    if(discordMembers >= 100000){

        score += 2;

    }

    else if(discordMembers >= 10000){

        score += 1;

    }



    /*
    ======================================
       ENGAGEMENT
    ======================================
    */


    if(engagementRate >= 10){

        score += 2;

    }

    else if(engagementRate >= 5){

        score += 1;

    }

    else if(engagementRate < 1){

        score -= 1;

    }



    /*
    ======================================
       COMMUNITY GROWTH
    ======================================
    */


    if(communityGrowth >= 50){

        score += 2;

    }

    else if(communityGrowth >= 10){

        score += 1;

    }

    else if(communityGrowth < -20){

        score -= 1;

    }



    /*
    ======================================
       ACTIVE USERS
    ======================================
    */


    if(activeUsers >= 100000){

        score += 2;

    }

    else if(activeUsers >= 10000){

        score += 1;

    }



    return normalize(

        score,

        SCORE.COMMUNITY

    );

}

/* =========================================
   DEVELOPMENT
========================================= */

function calculateFinancial(data = {}) {

    let score = 0;

    const treasury =
        Number(data.treasury || 0);

    const cashRunway =
        Number(data.cash_runway_months || 0);

    const revenue =
        Number(data.protocol_revenue || 0);

    const protocolFee =
        Number(data.protocol_fee || 0);

    const tvl =
        Number(data.tvl || 0);

    const tvlGrowth =
        Number(data.tvl_growth_30d || 0);

    const revenueGrowth =
        Number(data.revenue_growth_30d || 0);

    const buyback =
        Number(data.token_buyback || 0);

    const burn =
        Number(data.token_burn || 0);

    const stableReserve =
        Number(data.stablecoin_reserve || 0);

    const marketCap =
        Number(data.market_cap || 0);

    const fdv =
        Number(data.fdv || 0);

    const volume =
        Number(data.volume_24h || 0);

    const FINANCIAL_MAX = 25;

    /* ===============================
       Treasury
    =============================== */

    if (treasury >= 100000000) {

        score += 3;

    }
    else if (treasury >= 20000000) {

        score += 2;

    }
    else if (treasury > 0) {

        score += 1;

    }

    /* ===============================
       Cash Runway
    =============================== */

    if (cashRunway >= 24) {

        score += 2;

    }
    else if (cashRunway >= 12) {

        score += 1;

    }

    /* ===============================
       Revenue
    =============================== */

    if (revenue >= 10000000) {

        score += 3;

    }
    else if (revenue >= 1000000) {

        score += 2;

    }
    else if (revenue > 0) {

        score += 1;

    }

    /* ===============================
       Protocol Fee
    =============================== */

    if (protocolFee >= 1000000) {

        score += 2;

    }
    else if (protocolFee > 0) {

        score += 1;

    }

    /* ===============================
       TVL
    =============================== */

    if (tvl >= 1000000000) {

        score += 3;

    }
    else if (tvl >= 100000000) {

        score += 2;

    }
    else if (tvl >= 10000000) {

        score += 1;

    }

    /* ===============================
       TVL Growth
    =============================== */

    if (tvlGrowth >= 30) {

        score += 2;

    }
    else if (tvlGrowth >= 10) {

        score += 1;

    }

    /* ===============================
       Revenue Growth
    =============================== */

    if (revenueGrowth >= 30) {

        score += 2;

    }
    else if (revenueGrowth >= 10) {

        score += 1;

    }

   /* ===============================
   Buyback Ratio
=============================== */

const buybackRatio =

    marketCap > 0

        ?

        (
            buyback /
            marketCap
        )
        * 100

        :

        0;


if (buybackRatio >= 5) {

    score += 2;

}
else if (buybackRatio >= 1) {

    score += 1;

}

   /* ===============================
   Burn Ratio
=============================== */

const totalSupply =

    Number(
        data.total_supply || 0
    );


const burnRatio =

    totalSupply > 0

        ?

        (
            burn /
            totalSupply
        )
        * 100

        :

        0;



if (burnRatio >= 5) {

    score += 2;

}
else if (burnRatio >= 1) {

    score += 1;

}

    /* ===============================
       Stablecoin Reserve
    =============================== */

    if (stableReserve >= 50000000) {

        score += 2;

    }
    else if (stableReserve >= 5000000) {

        score += 1;

    }

    /* ===============================
       FDV Ratio
    =============================== */

    if (marketCap > 0 && fdv > 0) {

        const ratio =
            fdv / marketCap;

        if (ratio <= 2) {

            score += 2;

        }
        else if (ratio <= 5) {

            score += 1;

        }

    }

    /* ===============================
       Volume
    =============================== */

    if (volume >= 1000000) {

        score += 1;

    }

    return Math.round(

    (
        score /
        FINANCIAL_MAX
    )
    *
    SCORE.FINANCIAL

);

}

function calculateDevelopment(data = {}) {


    let score = 0;


    const githubScore =
        Number(
            data.github_score || 0
        );


    const stars =
        Number(
            data.github_stars || 0
        );


    const forks =
        Number(
            data.github_forks || 0
        );


    const contributors =
        Number(
            data.github_contributors || 0
        );


    const commits =
        Number(
            data.github_recent_commits || 0
        );


    const auditScore =
        Number(
            data.audit_score || 0
        );


    /*
    =====================================
       GITHUB QUALITY
    =====================================
    */


    if(githubScore >= 80){

        score += 5;

    }
    else if(githubScore >= 60){

        score += 4;

    }
    else if(githubScore >= 40){

        score += 2;

    }



    /*
    =====================================
       STARS
    =====================================
    */


    if(stars >= 10000){

        score += 2;

    }
    else if(stars >= 1000){

        score += 1;

    }



    /*
    =====================================
       CONTRIBUTORS
    =====================================
    */


    if(contributors >= 50){

        score += 1;

    }



    /*
    =====================================
       RECENT COMMITS
    =====================================
    */


    if(commits >= 100){

        score += 1;

    }



    /*
    =====================================
       AUDIT
    =====================================
    */


    if(auditScore >= 8){

        score += 1;

    }



    return normalize(
        score,
        SCORE.DEVELOPMENT
    );

}

/* =========================================
   ONCHAIN
========================================= */

function calculateOnchain(data){

    let score = 0;


    const liquidity =
        Number(data.liquidity || 0);


    const volume =
        Number(data.volume_24h || 0);


    if(liquidity >= 10000000){

        score += 5;

    }
    else if(liquidity >= 1000000){

        score += 3;

    }
    else if(liquidity > 100000){

        score += 1;

    }


    if(volume >= 10000000){

        score += 5;

    }
    else if(volume >= 1000000){

        score += 3;

    }


    return normalize(
        score,
        SCORE.ONCHAIN
    );

}

/* =========================================
   TOTAL
========================================= */

function calculate(data = {}) {

    const team =
        calculateTeam(data);

    const investor =
        calculateInvestor(data);

    const partner =
        calculatePartner(data);

    const tokenomics =
        calculateTokenomics(data);

    const financial =
        calculateFinancial(data);

    const community =
        calculateCommunity(data);

    const development =
        calculateDevelopment(data);

    const onchain =
        calculateOnchain(data);

    console.log("===== SCORE RESULT =====");
    console.table({
        team,
        investor,
        partner,
        tokenomics,
        financial,
        community,
        development,
        onchain
    });

    const overall =

        team +

        investor +

        partner +

        tokenomics +

        financial +

        community +

        development +

        onchain;

    console.log("OVERALL =", overall);

    return {

        team_score:
            team,

        investor_score:
            investor,

        partner_score:
            partner,

        tokenomics_score:
            tokenomics,

        financial_score:
            financial,

        community_score:
            community,

        development_score:
            development,

        onchain_score:
            onchain,

        overall_score:

            clamp(
                Math.round(overall),
                0,
                100
            )

    };

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    SCORE,

    calculate,

    calculateTeam,

    calculateInvestor,

    calculatePartner,

    calculateTokenomics,

    calculateFinancial,

    calculateCommunity,

    calculateDevelopment,

    calculateOnchain

};