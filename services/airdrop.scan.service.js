// =========================================
// services/airdrop.scan.service.js
// =========================================

"use strict";


/* =========================================
   MOCK PROJECTS -update
========================================= */

const fs = require("fs");
const path = require("path");

function getProjectsFromFile() {
    const filePath = path.join(__dirname, "../data/projects.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}

const scan =
require("./scan/scan.service");
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

};