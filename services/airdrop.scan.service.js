// =========================================
// services/airdrop.scan.service.js
// =========================================

"use strict";

const scoreService =
    require("./airdrop.score.service");

/* =========================================
   MOCK PROJECTS
========================================= */

const fs = require("fs");
const path = require("path");

function getProjectsFromFile() {
    const filePath = path.join(__dirname, "../data/projects.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}

/* =========================================
   NORMALIZE
========================================= */

function normalizeProject(project) {

    const analyzed =
        scoreService.analyzeProject(project);

    return {

        id:
            analyzed.id,

        title:
            analyzed.title ||
            analyzed.name ||
            "",

        source:
            analyzed.source ||
            "Unknown",

        url:
            analyzed.url ||
            "",

        funding:
            analyzed.funding || 0,

        community:
            analyzed.community || 0,

        investors:
            Array.isArray(
                analyzed.investors
            )
                ? analyzed.investors
                : [],

        token:
            Boolean(
                analyzed.token
            ),

        deadline:
            analyzed.deadline ||
            "",

        score:
            analyzed.score,

        rank:
            analyzed.rank,

        recommendation:
            analyzed.recommendation

    };

}

/* =========================================
   SORT
========================================= */

function sortProjects(projects) {

    return projects.sort(
        (a, b) => {

            if (
                b.score !==
                a.score
            ) {

                return (
                    b.score -
                    a.score
                );

            }

            return a.title.localeCompare(
                b.title
            );

        }
    );

}

/* =========================================
   SCAN
========================================= */

async function scan() {

    const projects = getProjectsFromFile();

    const normalized = projects.map(normalizeProject);

    return sortProjects(normalized);
}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    scan,

    normalizeProject,

    sortProjects,

    getMockProjects

};