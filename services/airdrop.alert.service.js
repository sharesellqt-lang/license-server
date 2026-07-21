"use strict";

const db = require("../db");
//const alertQueue =
   // require("./queue/alert.queue");

/* =========================================
   LOAD PROJECT DATA
========================================= */

async function loadProjects(userId) {

    const sql = `
        SELECT
            p.id,
            p.name,

            m.current_price,
            m.fdv,
            m.market_cap,
            m.fair_buy_price,
            m.total_score,
            m.risk_level,
            m.ath_price,
            m.circulating_supply,
            m.max_supply
        FROM airdrop_projects p
        LEFT JOIN airdrop_project_metrics m
            ON p.id = m.project_id
        WHERE p.user_id = ?
    `;

    const [rows] = await db.query(sql, [userId]);

    return rows || [];
}

function detectSignals(project) {

    const signals = [];

    const price = Number(project.current_price || 0);
    const fdv = Number(project.fdv || 0);
    const mc = Number(project.market_cap || 0);
    const ath = Number(project.ath_price || 0);
    const fair = Number(project.fair_buy_price || 0);

    /* =====================================
       1. Undervalued signal
    ===================================== */

    if (fair && price <= fair * 0.85) {

        signals.push({
            type: "UNDERVALUED",
            severity: "high",
            message: "Price is below fair buy zone"
        });

    }

    /* =====================================
       2. Overheated FDV
    ===================================== */

    if (mc && fdv && fdv > mc * 8) {

        signals.push({
            type: "OVERVALUED_FDV",
            severity: "high",
            message: "FDV is extremely high vs market cap"
        });

    }

    /* =====================================
       3. ATH breakout zone
    ===================================== */

    if (ath && price >= ath * 0.95) {

        signals.push({
            type: "ATH_NEAR",
            severity: "medium",
            message: "Price is near ATH zone"
        });

    }

    /* =====================================
       4. Low circulating risk
    ===================================== */

    const circulatingRatio =
        project.circulating_supply && project.max_supply
            ? project.circulating_supply / project.max_supply
            : 0;

    if (circulatingRatio < 0.2) {

        signals.push({
            type: "LOW_CIRCULATING",
            severity: "medium",
            message: "Very low circulating supply (unlock risk)"
        });

    }

    /* ===================================== */

    return signals;
}

function scoreSignals(signals) {

    let score = 0;

    for (const s of signals) {

        if (s.severity === "high") score += 30;
        else if (s.severity === "medium") score += 15;
        else score += 5;

    }

    return score;
}

async function generateAlerts(userId) {

    const projects = await loadProjects(userId);

    const alerts = [];

    for (const p of projects) {

        const signals = detectSignals(p);

        if (!signals.length) continue;

        const score = scoreSignals(signals);

        await alertQueue.add("new-alert", {
            userId,
            project: p.name,
            signals,
            score,
            timestamp: Date.now()
        });

        alerts.push({

            project_id: p.id,
            project_name: p.name,

            risk_level: p.risk_level,
            total_score: p.total_score,

            alert_score: score,

            signals
        });

    }

    /* =====================================
       SORT by severity
    ===================================== */

    alerts.sort(
        (a, b) =>
            b.alert_score - a.alert_score
    );

    return {

        total_alerts: alerts.length,

        alerts
    };
}

module.exports = {

    generateAlerts
};

