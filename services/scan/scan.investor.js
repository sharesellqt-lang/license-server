// =========================================
// services/scan/scan.investor.js
// =========================================

"use strict";


/*
=========================================
 INVESTOR SCANNER

 Input:
 projectId

 Output:
 investor_score

 Data source:
 investor.repository.js

 Purpose:
 Calculate investor credibility
=========================================
*/


const investorService =
    require("../airdrop.investor.service");



/* =========================================
   HELPERS
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



function text(value){

    return String(
        value || ""
    )
    .toLowerCase();

}





/* =========================================
   KNOWN INVESTORS
========================================= */


const TOP_INVESTORS = [

    "a16z",

    "andreessen",

    "paradigm",

    "binance labs",

    "coinbase ventures",

    "polychain",

    "multicoin",

    "pantera",

    "jump crypto",

    "framework",

    "dragonfly",

    "animoca",

    "hashed",

    "galaxy",

    "sequoia",

    "electric capital",

    "defiance"

];





/* =========================================
   INVESTOR QUALITY SCORE
========================================= */


function calculateInvestorScore(
    investors = []
){

    if(

        !Array.isArray(investors)

        ||

        investors.length === 0

    ){

        return 0;

    }



    let score = 0;



    /*
    =====================================
       NUMBER OF INVESTORS
    =====================================
    */


    const count =
        investors.length;



    if(
        count >= 10
    ){

        score += 20;

    }

    else if(
        count >= 5
    ){

        score += 15;

    }

    else if(
        count >= 2
    ){

        score += 8;

    }





    /*
    =====================================
       TOP VC
    =====================================
    */


    let topCount = 0;



    investors.forEach(inv=>{


        const name =

            text(

                inv.name ||

                inv.company ||

                inv.investor

            );



        if(

            TOP_INVESTORS.some(

                item =>
                name.includes(item)

            )

        ){

            topCount++;

        }


    });



    if(
        topCount >= 5
    ){

        score += 40;

    }

    else if(
        topCount >= 3
    ){

        score += 30;

    }

    else if(
        topCount >= 1
    ){

        score += 15;

    }





    /*
    =====================================
       INVESTMENT ROUND
    =====================================
    */


    let totalFunding = 0;



    investors.forEach(inv=>{


        totalFunding +=

            number(

                inv.amount ||

                inv.investment ||

                inv.funding

            );


    });



    /*
    VND/USD independent
    just magnitude scoring
    */


    if(
        totalFunding >= 50000000
    ){

        score += 20;

    }

    else if(
        totalFunding >= 10000000
    ){

        score += 12;

    }





    /*
    =====================================
       VERIFIED DATA
    =====================================
    */


    let verified = 0;



    investors.forEach(inv=>{


        if(

            inv.website ||

            inv.twitter ||

            inv.url

        ){

            verified++;

        }


    });



    if(
        verified >= 5
    ){

        score += 20;

    }

    else if(
        verified >= 2
    ){

        score += 10;

    }





    return Math.min(

        Math.round(score),

        100

    );


}







/* =========================================
   SCAN INVESTOR
========================================= */


async function scanInvestor(
    context={}
){

    const projectId =
        context.projectId;



    if(!projectId){

       return {

    investor_score,

    investors,

    total_investors

}

    }



    const investors =

        await investorService.getByProject(

            projectId

        );





    const score =

        calculateInvestorScore(

            investors

        );



console.log("========== INVESTOR RESULT ==========");
console.log(result);

    return {


        /*
        ===============================
           DATA
        ===============================
        */


        investor_count:

            investors.length,



        investors:

            investors.map(inv=>({

                name:

                    inv.name || "",


                type:

                    inv.type || "",


                amount:

                    number(

                        inv.amount

                    )


            })),




        /*
        ===============================
           SCORE
        ===============================
        */


        investor_score:

            score


    };


}







/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanInvestor,


    calculateInvestorScore


};