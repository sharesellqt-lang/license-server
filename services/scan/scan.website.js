// =========================================
// services/scan/scan.website.js
// =========================================

"use strict";

const fetch =
    global.fetch ||
    require("node-fetch");


/* =========================================
   HELPERS
========================================= */

function number(value){

    value =
        Number(value);

    return Number.isFinite(value)
        ? value
        : 0;

}


function normalizeUrl(url){

    if(!url){

        return null;

    }

    try{

        return new URL(url);

    }
    catch(_){

        return null;

    }

}


async function request(url){

    try{

        const res =
            await fetch(
                url,
                {

                    method:
                        "GET",

                    headers:{

                        "User-Agent":
                            "Airdrop-Intelligence"

                    },

                    timeout:
                        10000

                }
            );

        return {

            ok:
                res.ok,

            status:
                res.status,

            text:
                await res.text()

        };

    }
    catch(_){

        return {

            ok:
                false,

            status:
                0,

            text:
                ""

        };

    }

}


/* =========================================
   SSL
========================================= */

function checkSSL(url){

    const parsed =
        normalizeUrl(url);

    return !!parsed &&
        parsed.protocol === "https:";

}


/* =========================================
   SOCIAL
========================================= */

function detectSocial(html=""){

    const text =
        html.toLowerCase();

    return {

        twitter:
            text.includes("twitter.com") ||
            text.includes("x.com"),

        discord:
            text.includes("discord.gg"),

        telegram:
            text.includes("t.me"),

        github:
            text.includes("github.com"),

        medium:
            text.includes("medium.com")

    };

}


/* =========================================
   DOCUMENTS
========================================= */

function detectDocuments(html=""){

    const text =
        html.toLowerCase();

    return {

        whitepaper:
            text.includes("whitepaper") ||
            text.includes("litepaper"),

        docs:
            text.includes("docs.") ||
            text.includes("/docs"),

        roadmap:
            text.includes("roadmap")

    };

}


/* =========================================
   SCORE
========================================= */

function calculateWebsiteScore(data={}){

    let score = 0;

    if(data.ssl){

        score += 15;

    }

    const socialCount =
        Object.values(
            data.social || {}
        )
        .filter(Boolean)
        .length;

    if(socialCount >= 5){

        score += 25;

    }
    else if(socialCount >= 3){

        score += 15;

    }
    else if(socialCount >= 1){

        score += 5;

    }

    if(data.documents?.whitepaper){

        score += 20;

    }

    if(data.documents?.docs){

        score += 15;

    }

    if(data.documents?.roadmap){

        score += 10;

    }

    if(data.online){

        score += 15;

    }

    return Math.min(
        score,
        100
    );

}


/* =========================================
   SCAN WEBSITE
========================================= */

async function scanWebsite(context={}){

    const project =
        context.project || {};

    const url =
        project.website ||
        project.url ||
        project.site ||
        "";

    if(!url){

        return {

            website_score:
                0,

            community_score:
                0

        };

    }

    const response =
        await request(url);

    const social =
        detectSocial(
            response.text
        );

    const documents =
        detectDocuments(
            response.text
        );

    const ssl =
        checkSSL(url);

    const score =
        calculateWebsiteScore({

            ssl,

            online:
                response.ok,

            social,

            documents

        });

    const result = {

        website_url:
            url,

        online:
            response.ok,

        ssl,

        status:
            response.status,

        social,

        documents,

        website_score:
            score,

        community_score:
            score

    };

    console.log(
        "========== WEBSITE RESULT =========="
    );

    console.log(
        result
    );

    return result;

}


/* =========================================
   EXPORT
========================================= */

module.exports = {

    scanWebsite,

    calculateWebsiteScore,

    detectSocial,

    detectDocuments

};