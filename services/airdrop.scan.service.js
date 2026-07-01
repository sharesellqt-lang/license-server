// =========================================
// services/airdrop.scan.service.js
// =========================================

"use strict";

const scoreService =
    require("./airdrop.score.service");

/* =========================================
   MOCK PROJECTS
========================================= */

function getMockProjects() {

    return [

        {
            id: 1,
            title: "Monad",
            source: "CryptoRank",
            url: "https://cryptorank.io/drophunting/monad-activity750",
            funding: 95,
            community: 92,
            investors: [
                "Paradigm",
                "DragonFly",
                "Coinbase Ventures",
                "Electric Capital"
            ],
            token: false,
            deadline: "2026-12-31"
        },

        {
            id: 2,
            title: "MegaETH",
            source: "CryptoRank",
            url: "https://cryptorank.io",
            funding: 90,
            community: 88,
            investors: [
                "DragonFly",
                "Vitalik"
            ],
            token: false,
            deadline: "2026-10-15"
        },

        {
            id: 3,
            title: "Initia",
            source: "Airdrops.io",
            url: "https://airdrops.io",
            funding: 88,
            community: 82,
            investors: [
                "Binance Labs",
                "Delphi Ventures",
                "Hack VC"
            ],
            token: false,
            deadline: "2026-09-30"
        },

        {
            id: 4,
            title: "LayerZero",
            source: "Official",
            url: "https://layerzero.network",
            funding: 100,
            community: 98,
            investors: [
                "a16z",
                "Sequoia",
                "Coinbase Ventures",
                "PayPal Ventures"
            ],
            token: true,
            deadline: "Completed"
        },

        {
            id: 5,
            title: "Abstract",
            source: "CryptoRank",
            url: "https://cryptorank.io",
            funding: 82,
            community: 80,
            investors: [
                "Igloo",
                "Founders Fund"
            ],
            token: false,
            deadline: "2026-11-15"
        },

        {
            id: 6,
            title: "Berachain",
            source: "Official",
            url: "https://www.berachain.com",
            funding: 96,
            community: 90,
            investors: [
                "Polychain",
                "Hack VC"
            ],
            token: false,
            deadline: "2026-08-20"
        },

        {
            id: 7,
            title: "Fuel",
            source: "Airdrops.io",
            url: "https://fuel.network",
            funding: 84,
            community: 78,
            investors: [
                "Blockchain Capital"
            ],
            token: false,
            deadline: "2026-09-05"
        },

        {
            id: 8,
            title: "Succinct",
            source: "CryptoRank",
            url: "https://cryptorank.io",
            funding: 87,
            community: 75,
            investors: [
                "Paradigm"
            ],
            token: false,
            deadline: "2026-11-01"
        }

    ];

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

    /*
    ------------------------------------------------
    Hiện tại dùng Mock Data.

    Sau này chỉ cần thay phần này bằng:

    - RSS
    - API
    - Database
    - Web Scraper

    mà không phải sửa frontend.
    ------------------------------------------------
    */

    const projects =
        getMockProjects();

    const normalized =
        projects.map(
            normalizeProject
        );

    return sortProjects(
        normalized
    );

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