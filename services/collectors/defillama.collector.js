// =========================================
// services/collectors/defillama.collector.js
// =========================================

"use strict";

const fetch =
    global.fetch ||
    require("node-fetch");

const BASE_URL =
    "https://api.llama.fi";

/* =========================================
   HELPERS
========================================= */

function number(value){

    value = Number(value);

    if(!Number.isFinite(value)){

        return 0;

    }

    return value;

}

async function request(path){

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            ()=>controller.abort(),
            10000
        );

    try{

        const res =
            await fetch(
                BASE_URL + path,
                {
                    signal:
                        controller.signal
                }
            );

        clearTimeout(timeout);

        if(!res.ok){

            throw new Error(
                `DefiLlama ${res.status}`
            );

        }

        return await res.json();

    }

    finally{

        clearTimeout(timeout);

    }

}

/* =========================================
   TVL HISTORY
========================================= */

function extractHistory(protocol){

    if(!protocol){

        return [];

    }

    if(

        protocol.chainTvls &&

        protocol.chains?.length

    ){

        const firstChain =
            protocol.chains[0];

        const chain =
            protocol.chainTvls[firstChain];

        if(

            chain &&
            Array.isArray(chain.tvl)

        ){

            return chain.tvl;

        }

    }

    return [];

}

function calculateGrowth(history){

    if(

        !Array.isArray(history) ||

        history.length < 2

    ){

        return 0;

    }

    const latest =
        number(
            history.at(-1)?.totalLiquidityUSD
        );

    const previous =
        number(
            history.at(-2)?.totalLiquidityUSD
        );

    if(previous<=0){

        return 0;

    }

    return Number(

        (

            (

                latest -

                previous

            )

            /

            previous

            *

            100

        ).toFixed(2)

    );

}

/* =========================================
   SCORE
========================================= */

function calculateScore(data={}){

    let score = 0;

    const tvl =
        number(data.tvl);

    if(tvl>=1_000_000_000){

        score += 40;

    }
    else if(tvl>=100_000_000){

        score += 30;

    }
    else if(tvl>=10_000_000){

        score += 20;

    }
    else if(tvl>=1_000_000){

        score += 10;

    }

    const growth =
        number(data.tvl_growth);

    if(growth>=20){

        score += 25;

    }
    else if(growth>=10){

        score += 18;

    }
    else if(growth>=5){

        score += 12;

    }
    else if(growth>0){

        score += 5;

    }

    const audits =
        number(data.audit_count);

    if(audits>=3){

        score += 35;

    }
    else if(audits>=2){

        score += 25;

    }
    else if(audits>=1){

        score += 15;

    }

    return Math.min(score,100);

}

/* =========================================
   FETCH PROTOCOL
========================================= */

async function fetchProtocol(slug){

    if(!slug){

        return {};

    }

    try{

        const protocol =
            await request(
                `/protocol/${slug}`
            );

        const history =
            extractHistory(protocol);

        const tvlGrowth =
            calculateGrowth(history);

        const result = {

            defillama_slug:
                slug,

            protocol_name:
                protocol.name || "",

            protocol_category:
                protocol.category || "",

            protocol_chains:
                protocol.chains || [],

            tvl:
                number(protocol.tvl),

            tvl_growth:
                tvlGrowth,

            tvl_history_points:
                history.length,

            listed:true,

            audits:
                protocol.audits || [],

            audit_count:

                Array.isArray(protocol.audits)

                    ? protocol.audits.length

                    : 0,

            github:
                protocol.github || [],

            twitter:
                protocol.twitter || "",

            website:
                protocol.url || ""

        };

        result.defillama_score =
            calculateScore(result);

        return result;

    }

    catch(err){

        console.log(
            "========== DEFILLAMA ERROR =========="
        );

        console.log(err.message);

        return {};

    }

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchProtocol,

    calculateScore

};