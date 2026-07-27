"use strict";

/* =========================================
   NORMALIZE SYMBOL
========================================= */

function normalize(symbol) {

    return String(symbol || "")
        .trim()
        .toUpperCase();

}

/* =========================================
   ENRICH TOKENS WITH PROJECT DATA
========================================= */

function enrichWithProjectData(tokens = [], projectMap = {}) {

    return tokens.map(token => {

        const symbol =
            normalize(token.token_symbol);

        const project =
            projectMap[symbol] || {};

        return {

            ...token,

            project_name:
                project.name || "",

            project_score:
                Number(project.total_score || 0),

            investment_score:
                Number(project.investment_score || 0),

            investment_rating:
                project.investment_rating || "",

            investment_action:
                project.investment_action || "",

            risk_level:
                project.risk_level || "unknown",

            market_cap:
                Number(project.market_cap || 0),

            fdv:
                Number(project.fdv || 0),

            current_price:
                Number(project.current_price || 0),

            fair_buy_price:
                Number(project.fair_buy_price || 0),

            recommendation:
                project.recommendation || ""

        };

    });

}

module.exports = {

    enrichWithProjectData

};