"use strict";

/* =========================================
   DEFI LLAMA COLLECTOR
========================================= */

const fetch =
    global.fetch ||
    require("node-fetch");

const API =
    "https://api.llama.fi";

/* =========================================
   HELPERS
========================================= */

function number(value) {

    value = Number(value);

    if (!Number.isFinite(value)) {

        return 0;

    }

    return value;

}

async function request(path) {

    const res =
        await fetch(
            API + path
        );

    if (!res.ok) {

        throw new Error(
            `DefiLlama ${res.status}`
        );

    }

    return await res.json();

}

/* =========================================
   TVL HISTORY
========================================= */

function calculateGrowth(history = []) {

    if (

        !Array.isArray(history) ||

        history.length < 2

    ) {

        return 0;

    }

    const latest =
        number(
            history[
                history.length - 1
            ]?.totalLiquidityUSD
        );

    const previous =
        number(
            history[
                history.length - 2
            ]?.totalLiquidityUSD
        );

    if (

        previous <= 0

    ) {

        return 0;

    }

    return Number(

        (
            (

                latest -

                previous

            ) /

            previous *

            100

        ).toFixed(2)

    );

}

/* =========================================
   CHAINS
========================================= */

function parseChains(protocol) {

    if (

        !Array.isArray(
            protocol.chains
        )

    ) {

        return [];

    }

    return protocol.chains;

}

/* =========================================
   CATEGORY
========================================= */

function parseCategory(protocol) {

    return (

        protocol.category ||

        ""

    );

}

/* =========================================
   MAIN
========================================= */

async function fetchProtocol(slug) {

    if (!slug) {

        return null;

    }

    const protocol =
        await request(

            `/protocol/${slug}`

        );

    const currentTVL =
        number(
            protocol.tvl
        );

    const history =
        protocol.chainTvls?.[
            protocol.chains?.[0]
        ]?.tvl ||
        [];

    const growth =
        calculateGrowth(
            history
        );

    return {

        defillama_slug:

            slug,

        protocol_name:

            protocol.name ||

            "",

        protocol_category:

            parseCategory(
                protocol
            ),

        protocol_chains:

            parseChains(
                protocol
            ),

        tvl:

            currentTVL,

        tvl_growth:

            growth,

        tvl_history_points:

            history.length,

        listed:

            true,

        audits:

            protocol.audits ||

            [],

        audit_count:

            Array.isArray(
                protocol.audits
            )

                ? protocol.audits.length

                : 0,

        github:

            protocol.github ||

            [],

        twitter:

            protocol.twitter ||

            "",

        website:

            protocol.url ||

            "",

        defillama_score:

            calculateScore({

                tvl:
                    currentTVL,

                growth,

                audits:
                    protocol.audits

            })

    };

}

/* =========================================
   SCORE
========================================= */

function calculateScore(data = {}) {

    let score = 0;

    const tvl =
        number(
            data.tvl
        );

    if (

        tvl >= 1000000000

    ) {

        score += 40;

    }

    else if (

        tvl >= 100000000

    ) {

        score += 30;

    }

    else if (

        tvl >= 10000000

    ) {

        score += 20;

    }

    else if (

        tvl >= 1000000

    ) {

        score += 10;

    }

    const growth =
        number(
            data.growth
        );

    if (

        growth >= 20

    ) {

        score += 25;

    }

    else if (

        growth >= 10

    ) {

        score += 18;

    }

    else if (

        growth >= 5

    ) {

        score += 12;

    }

    else if (

        growth > 0

    ) {

        score += 5;

    }

    const audits =
        Array.isArray(
            data.audits
        )

            ? data.audits.length

            : 0;

    if (

        audits >= 3

    ) {

        score += 35;

    }

    else if (

        audits >= 2

    ) {

        score += 25;

    }

    else if (

        audits >= 1

    ) {

        score += 15;

    }

    if (

        score > 100

    ) {

        score = 100;

    }

    return score;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchProtocol,

    calculateScore

};