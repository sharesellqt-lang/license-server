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

/* =========================================
   HELPERS
========================================= */

function clamp(value, min, max) {

    value = Number(value);

    if (Number.isNaN(value)) {

        value = 0;

    }

    return Math.min(
        Math.max(value, min),
        max
    );

}

function normalize(value, max) {

    return clamp(value, 0, max);

}

/* =========================================
   TEAM
========================================= */

function calculateTeam(data) {

    return normalize(

        data.team_score,

        SCORE.TEAM

    );

}

/* =========================================
   INVESTOR
========================================= */

function calculateInvestor(data) {

    return normalize(

        data.investor_score,

        SCORE.INVESTOR

    );

}

/* =========================================
   PARTNER
========================================= */

function calculatePartner(data) {

    return normalize(

        data.partner_score,

        SCORE.PARTNER

    );

}

/* =========================================
   TOKENOMICS
========================================= */

function calculateTokenomics(data) {

    let score = Number(

        data.tokenomics_score || 0

    );

    if (

        data.circulating_percent >= 50

    ) {

        score += 3;

    }

    if (

        data.locked_percent <= 50

    ) {

        score += 3;

    }

    if (

        data.fdv > 0 &&
        data.market_cap > 0

    ) {

        const ratio =
            data.fdv /
            data.market_cap;

        if (ratio <= 2) {

            score += 4;

        }

        else if (ratio <= 4) {

            score += 2;

        }

    }

    return normalize(

        score,

        SCORE.TOKENOMICS

    );

}

/* =========================================
   FINANCIAL
========================================= */

function calculateFinancial(data) {

    let score = Number(

        data.financial_score || 0

    );

    if (

        Number(data.funding_amount) >=
        100000000

    ) {

        score += 5;

    }

    else if (

        Number(data.funding_amount) >=
        20000000

    ) {

        score += 3;

    }

    else if (

        Number(data.funding_amount) > 0

    ) {

        score += 1;

    }

    return normalize(

        score,

        SCORE.FINANCIAL

    );

}

/* =========================================
   COMMUNITY
========================================= */

function calculateCommunity(data) {

    return normalize(

        data.community_score,

        SCORE.COMMUNITY

    );

}

/* =========================================
   DEVELOPMENT
========================================= */

function calculateDevelopment(data) {

    return normalize(

        data.development_score,

        SCORE.DEVELOPMENT

    );

}

/* =========================================
   ONCHAIN
========================================= */

function calculateOnchain(data) {

    return normalize(

        data.onchain_score,

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

    const overall =

        team +

        investor +

        partner +

        tokenomics +

        financial +

        community +

        development +

        onchain;

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