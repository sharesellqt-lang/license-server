"use strict";

const db = require("../db");

const analysisService =
    require("./airdrop.analysis.service");

/* =========================================
   GET DASHBOARD
========================================= */

async function getDashboard(userId) {

    const sql = `
        SELECT
            p.id,
            p.name,
            p.status,
            p.created_at,

            m.current_price,
            m.market_cap,
            m.fdv,
            m.total_score,
            m.risk_level
        FROM airdrop_projects p
        LEFT JOIN airdrop_project_metrics m
            ON p.id = m.project_id
        WHERE p.user_id = ?
        ORDER BY m.total_score DESC, p.created_at DESC
    `;

    const [rows] =
        await db.query(sql, [userId]);

    const projects =
        rows.map(p => {

            const analysis =
                analysisService.analyze({
                    current_price: p.current_price,
                    market_cap: p.market_cap,
                    fdv: p.fdv
                });

            return {

                id: p.id,
                name: p.name,
                status: p.status,

                metrics: {
                    current_price: p.current_price,
                    market_cap: p.market_cap,
                    fdv: p.fdv,
                    total_score: p.total_score,
                    risk_level: p.risk_level
                },

                analysis
            };

        });

    /* =====================================
       SUMMARY STATS
    ===================================== */

    const total = projects.length;

    const avgScore =
        total
            ? projects.reduce(
                (sum, p) =>
                    sum + (p.metrics.total_score || 0),
                0
              ) / total
            : 0;

    const riskCount = {

        low: 0,
        medium: 0,
        high: 0,
        "very-high": 0

    };

    projects.forEach(p => {

        const r = p.metrics.risk_level || "medium";

        if (riskCount[r] !== undefined) {

            riskCount[r]++;

        }

    });

    const topProjects =
        projects
            .slice(0, 10);

    return {

        summary: {

            total_projects: total,

            average_score:
                Number(avgScore.toFixed(2)),

            risk_distribution:
                riskCount

        },

        top_projects:
            topProjects,

        all_projects:
            projects

    };

}

module.exports = {

    getDashboard

};