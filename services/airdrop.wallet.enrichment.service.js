"use strict";

/* =========================================
   ENRICH TOKENS WITH PROJECT DATA
========================================= */

function enrichWithProjectData(tokens, projectMap) {

    return tokens.map(token => {

        const project =
            projectMap[token.token];

        return {

            ...token,

            project_score:
                project?.total_score || 0,

            risk_level:
                project?.risk_level || "unknown",

            fdv:
                project?.fdv || 0,

            market_cap:
                project?.market_cap || 0,

            fair_buy_price:
                project?.fair_buy_price || 0,

            project_name:
                project?.name || null

        };

    });

}

module.exports = {
    enrichWithProjectData
};