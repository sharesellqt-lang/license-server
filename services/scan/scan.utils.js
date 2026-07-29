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


    if(
        !Number.isFinite(value)
    ){

        return 0;

    }


    return value;

}





/* =========================================
   CLAMP
========================================= */


function clamp(
    value,
    min = 0,
    max = 100
){

    value =
        number(value);


    return Math.min(

        Math.max(

            value,

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



    if(
        total <= 0
    ){

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
   NORMALIZE STRING
========================================= */


function normalize(
    value
){

    return String(

        value || ""

    )
    .trim()
    .toLowerCase();

}





/* =========================================
   SAFE JSON PARSE
========================================= */


function safeJson(
    value,
    fallback = {}
){

    if(
        !value
    ){

        return fallback;

    }



    if(
        typeof value === "object"
    ){

        return value;

    }



    try{

        return JSON.parse(
            value
        );

    }

    catch(_){

        return fallback;

    }

}





/* =========================================
   DATE HELPERS
========================================= */


function daysSince(
    date
){

    if(
        !date
    ){

        return null;

    }



    const d =
        new Date(
            date
        );



    if(
        Number.isNaN(
            d.getTime()
        )
    ){

        return null;

    }



    return Math.floor(

        (

            Date.now()

            -

            d.getTime()

        )

        /

        86400000

    );

}





function isRecent(
    date,
    days = 30
){

    const diff =
        daysSince(
            date
        );


    if(
        diff === null
    ){

        return false;

    }


    return diff <= days;

}





/* =========================================
   SCORE GRADE
========================================= */


function scoreGrade(
    score
){

    score =
        clamp(score);



    if(
        score >=90
    ){

        return "S";

    }



    if(
        score >=80
    ){

        return "A";

    }



    if(
        score >=70
    ){

        return "B";

    }



    if(
        score >=60
    ){

        return "C";

    }



    if(
        score >=40
    ){

        return "D";

    }



    return "F";

}





/* =========================================
   RISK LEVEL
========================================= */


function riskLevel(
    score
){

    score =
        clamp(score);



    /*
        score cao = an toàn
    */


    if(
        score >=80
    ){

        return "low";

    }


    if(
        score >=60
    ){

        return "medium";

    }


    if(
        score >=40
    ){

        return "high";

    }


    return "very-high";

}





/* =========================================
   RISK SCORE
========================================= */


function calculateRiskScore(
    data={}
){

    let risk = 0;



    if(
        data.anonymous_team
    ){

        risk +=20;

    }



    if(
        data.no_audit
    ){

        risk +=20;

    }



    if(
        data.high_fdv
    ){

        risk +=15;

    }



    if(
        data.low_liquidity
    ){

        risk +=15;

    }



    if(
        data.inactive_github
    ){

        risk +=10;

    }



    if(
        data.bad_notes
    ){

        risk +=20;

    }



    return clamp(
        risk
    );

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

            number(
                scores[key]
            );


        const weight =

            number(
                weights[key]
            );



        total +=

            value *

            weight;



        weightTotal +=

            weight;



    });





    if(
        weightTotal <=0
    ){

        return 0;

    }



    return Math.round(

        total /

        weightTotal

    );

}





/* =========================================
   MERGE SCAN RESULT
========================================= */


function mergeResults(
    results=[]
){

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


function createScoreSummary(
    scores={}
){

    const total =

        weightedScore(

            scores,

            {

                team:0.15,

                investor:0.15,

                partner:0.10,

                tokenomics:0.15,

                financial:0.15,

                community:0.10,

                development:0.10,

                onchain:0.10

            }

        );



    return {


        scores,



        overall_score:

            total,



        grade:

            scoreGrade(
                total
            ),



        risk_level:

            riskLevel(
                total
            )


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