// =========================================
// services/scan/scan.utils.js
// =========================================

"use strict";


/* =========================================
   NUMBER
========================================= */

function number(value){

    value =
        Number(value);

    return Number.isFinite(value)
        ? value
        : 0;

}


/* =========================================
   CLAMP
========================================= */

function clamp(
    value,
    min = 0,
    max = 100
){

    return Math.min(

        Math.max(

            number(value),

            min

        ),

        max

    );

}


/* =========================================
   PERCENT
========================================= */

function percent(
    value,
    total
){

    value =
        number(value);

    total =
        number(total);

    if(total <= 0){

        return 0;

    }

    return Number(

        (
            value /
            total *
            100
        )
        .toFixed(2)

    );

}


/* =========================================
   NORMALIZE
========================================= */

function normalize(value){

    return String(
        value || ""
    )
    .trim()
    .toLowerCase();

}


/* =========================================
   SAFE JSON
========================================= */

function safeJson(
    value,
    fallback = {}
){

    if(!value){

        return fallback;

    }

    if(typeof value === "object"){

        return value;

    }

    try{

        return JSON.parse(value);

    }
    catch(_){

        return fallback;

    }

}


/* =========================================
   DATE
========================================= */

function daysSince(date){

    if(!date){

        return null;

    }

    const d =
        new Date(date);

    if(Number.isNaN(d.getTime())){

        return null;

    }

    return Math.floor(

        (
            Date.now() -
            d.getTime()
        )
        / 86400000

    );

}


function isRecent(
    date,
    days = 30
){

    const diff =
        daysSince(date);

    return diff !== null &&
        diff <= days;

}


/* =========================================
   SCORE GRADE
========================================= */

function scoreGrade(score){

    score =
        clamp(score);

    if(score >= 90){

        return "S";

    }

    if(score >= 80){

        return "A";

    }

    if(score >= 70){

        return "B";

    }

    if(score >= 60){

        return "C";

    }

    if(score >= 40){

        return "D";

    }

    return "F";

}


/* =========================================
   RISK LEVEL
========================================= */

function riskLevel(score){

    score =
        clamp(score);

    if(score >= 80){

        return "low";

    }

    if(score >= 60){

        return "medium";

    }

    if(score >= 40){

        return "high";

    }

    return "very-high";

}


/* =========================================
   RISK SCORE
========================================= */

function calculateRiskScore(data={}){

    let risk = 0;

    if(data.anonymous_team){

        risk += 20;

    }

    if(data.no_audit){

        risk += 20;

    }

    if(data.high_fdv){

        risk += 15;

    }

    if(data.low_liquidity){

        risk += 15;

    }

    if(data.inactive_github){

        risk += 10;

    }

    if(data.bad_notes){

        risk += 20;

    }

    return clamp(risk);

}


/* =========================================
   WEIGHTED SCORE
========================================= */

function weightedScore(
    scores = {},
    weights = {}
){

    let total = 0;
    let weightTotal = 0;

    Object.keys(scores)
    .forEach(key=>{

        const value =
            number(scores[key]);

        const weight =
            number(weights[key]);

        total +=
            value * weight;

        weightTotal +=
            weight;

    });

    if(weightTotal <= 0){

        return 0;

    }

    return Math.round(
        total /
        weightTotal
    );

}


/* =========================================
   MERGE RESULT
========================================= */

function mergeResults(results=[]){

    const output = {};

    results.forEach(item=>{

        if(
            item &&
            typeof item === "object"
        ){

            Object.assign(
                output,
                item
            );

        }

    });

    return output;

}


/* =========================================
   SCORE SUMMARY
========================================= */

function createScoreSummary(scores = {}) {

    const normalized = {

        team:
            clamp(
                scores.team_score ??
                scores.team ??
                0
            ),

        investor:
            clamp(
                scores.investor_score ??
                scores.investor ??
                0
            ),

        partner:
            clamp(
                scores.partner_score ??
                scores.partner ??
                0
            ),

        tokenomics:
            clamp(
                scores.tokenomics_score ??
                scores.tokenomics ??
                0
            ),

        financial:
            clamp(
                scores.financial_score ??
                scores.financial ??
                0
            ),

        community:
            clamp(
                scores.community_score ??
                scores.community ??
                0
            ),

        development:
            clamp(
                scores.development_score ??
                scores.development ??
                0
            ),

        onchain:
            clamp(
                scores.onchain_score ??
                scores.onchain ??
                0
            )

    };

    const overall = Math.round(

        normalized.team * 0.15 +

        normalized.investor * 0.15 +

        normalized.partner * 0.10 +

        normalized.tokenomics * 0.15 +

        normalized.financial * 0.15 +

        normalized.community * 0.10 +

        normalized.development * 0.10 +

        normalized.onchain * 0.10

    );

    return {

        team_score:
            normalized.team,

        investor_score:
            normalized.investor,

        partner_score:
            normalized.partner,

        tokenomics_score:
            normalized.tokenomics,

        financial_score:
            normalized.financial,

        community_score:
            normalized.community,

        development_score:
            normalized.development,

        onchain_score:
            normalized.onchain,

        overall_score:
            overall,

        grade:
            scoreGrade(overall),

        risk_level:
            riskLevel(overall)

    };

}


/* =========================================
   EXPORT
========================================= */

module.exports = {

    number,

    clamp,

    percent,

    normalize,

    safeJson,

    daysSince,

    isRecent,

    scoreGrade,

    riskLevel,

    calculateRiskScore,

    weightedScore,

    mergeResults,

    createScoreSummary

};