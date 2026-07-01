// =========================================
// services/airdrop.export.service.js
// =========================================

"use strict";

const repo = require("./airdrop.repository");

/* =========================================
   JSON EXPORT
========================================= */

async function exportJson(userId) {

    const data =
        await repo.getProjectsByUser(userId);

    return JSON.stringify(data, null, 2);
}

/* =========================================
   CSV EXPORT
========================================= */

async function exportCsv(userId) {

    const data =
        await repo.getProjectsByUser(userId);

    const header = [
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

    const rows = [header];

    for (const p of data) {

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
        .map(r =>
            r.map(v =>
                `"${String(v ?? "").replace(/"/g, '""')}"`
            ).join(",")
        )
        .join("\n");
}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    exportJson,
    exportCsv

};