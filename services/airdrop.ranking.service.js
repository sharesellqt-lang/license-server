"use strict";

const db = require("../db");

/* =========================================
   GET RANKING
========================================= */

async function getRanking(userId, filter = {}) {

    const mode =
        filter.mode || "all"; 
        // all | buy | low_risk | high_roi

    const sql = `
        SELECT
            p.id,
            p.name,
            p.status,

            m.current_price,
            m.market_cap,
            m.fdv,
            m.total_score,
            m.risk_level,
            m.fair_buy_price,
            m.fair_sell_price
        FROM airdrop_projects p
        LEFT JOIN airdrop_project_metrics m
            ON p.id = m.project_id
        WHERE p.user_id = ?
    `;

    const [rows] =
        await db.query(sql, [userId]);

    let projects =
        rows.map(p => {

            const upside =
                p.fair_buy_price && p.current_price
                    ? ((p.fair_buy_price - p.current_price) /
                       p.current_price) * 100
                    : 0;

            const riskWeight = {

                "low": 1,
                "medium": 2,
                "high": 3,
                "very-high": 4

            };

            const riskScore =
                riskWeight[p.risk_level] || 2;

            return {

                id: p.id,
                name: p.name,

                current_price:
                    p.current_price,

                market_cap:
                    p.market_cap,

                fdv:
                    p.fdv,

                score:
                    p.total_score || 0,

                risk_level:
                    p.risk_level || "medium",

                upside:

                    Number(upside.toFixed(2)),

                rank_score:

                    (p.total_score || 0) * 0.6 -

                    riskScore * 10 +

                    upside * 0.4

            };

        });

    /* =========================================
       FILTER LOGIC
    ========================================= */

    if (mode === "buy") {

        projects =
            projects.filter(p =>
                p.upside > 20 &&
                p.risk_level !== "very-high"
            );

    }

    if (mode === "low_risk") {

        projects =
            projects.filter(p =>
                p.risk_level === "low" ||
                p.risk_level === "medium"
            );

    }

   if (mode === "high_roi") {

    projects.sort(
        (a, b) => b.upside - a.upside
    );

} else {

    projects.sort(
        (a, b) => b.rank_score - a.rank_score
    );

}

    return {

        mode,

        total:
            projects.length,

        projects

    };

}

module.exports = {

    getRanking

};