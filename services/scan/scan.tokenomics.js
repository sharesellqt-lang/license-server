// =========================================
// services/scan/scan.tokenomics.js
// =========================================

"use strict";


const metricsService =
    require("../airdrop.metrics.service");



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



function percent(
    value
){

    return Number(
        number(value).toFixed(2)
    );

}




/* =========================================
   CIRCULATION SCORE
========================================= */


function calculateCirculationScore(
    data={}
){

    const total =
        number(
            data.total_supply
        );


    const circulating =
        number(
            data.circulating_supply
        );


    if(
        total <= 0 ||
        circulating <= 0
    ){

        return 0;

    }



    const ratio =
        circulating /
        total *
        100;



    /*
       Good:
       >70% circulating

       Bad:
       <20%
    */


    if(
        ratio >= 70
    ){

        return 25;

    }


    if(
        ratio >= 50
    ){

        return 18;

    }


    if(
        ratio >= 30
    ){

        return 10;

    }


    if(
        ratio >= 20
    ){

        return 5;

    }


    return 0;

}




/* =========================================
   FDV PRESSURE
========================================= */


function calculateFDVScore(
    data={}
){

    const mc =
        number(
            data.market_cap
        );


    const fdv =
        number(
            data.fdv
        );



    if(
        mc <=0 ||
        fdv <=0
    ){

        return 0;

    }



    const ratio =
        fdv /
        mc;



    /*
       Lower FDV gap = safer

       FDV/MC

       <=2 good
       <=5 medium
       >5 risky
    */


    if(
        ratio <=2
    ){

        return 20;

    }


    if(
        ratio <=5
    ){

        return 10;

    }


    return 0;

}





/* =========================================
   ALLOCATION SCORE
========================================= */


function calculateAllocationScore(
    data={}
){

    let score = 0;



    const community =
        number(
            data.community_allocation
        );


    const team =
        number(
            data.team_allocation
        );


    const investor =
        number(
            data.investor_allocation
        );



    /*
       Community allocation
    */


    if(
        community >=40
    ){

        score +=15;

    }

    else if(
        community >=25
    ){

        score +=10;

    }




    /*
       Team allocation

       too high = risk
    */


    if(
        team <=20 &&
        team >0
    ){

        score +=10;

    }




    /*
       Investor allocation

       avoid huge unlock
    */


    if(
        investor <=25 &&
        investor >0
    ){

        score +=10;

    }



    return score;

}





/* =========================================
   UNLOCK RISK
========================================= */


function calculateUnlockScore(
    data={}
){

    const unlock =
        number(
            data.unlock_percentage
        );



    if(
        unlock <=0
    ){

        return 10;
    }



    if(
        unlock <10
    ){

        return 10;

    }


    if(
        unlock <30
    ){

        return 5;

    }



    return 0;

}





/* =========================================
   TOTAL SCORE
========================================= */


function calculateTokenomicsScore(
    data={}
){

    let score = 0;



    score +=

        calculateCirculationScore(
            data
        );



    score +=

        calculateFDVScore(
            data
        );



    score +=

        calculateAllocationScore(
            data
        );



    score +=

        calculateUnlockScore(
            data
        );



    return Math.min(

        Math.round(score),

        100

    );

}





/* =========================================
   SCAN TOKENOMICS
========================================= */


async function scanTokenomics(
    context={}
){

    const projectId =
        context.projectId;



if(!projectId){

    return {

        tokenomics_score:0,

        circulating_percent:0,

        locked_percent:0,

        inflation:0,

        risk_score:0,

        seed_roi:0,

        private_roi:0,

        public_roi:0

    };

}




    const metrics =

        await metricsService.getByProject(

            projectId

        );





    if(!metrics){


        return {

            tokenomics_score:0

        };


    }





    const score =

        calculateTokenomicsScore(

            metrics

        );


console.log("========== TOKENOMICS RESULT ==========");

console.log({

    total_supply:
        metrics.total_supply,

    circulating_supply:
        metrics.circulating_supply,

    market_cap:
        metrics.market_cap,

    fdv:
        metrics.fdv,

    tokenomics_score:
        score

});


    return {


        /*
        ===============================
           SUPPLY
        ===============================
        */


        total_supply:

            number(
                metrics.total_supply
            ),



        circulating_supply:

            number(
                metrics.circulating_supply
            ),



        circulating_ratio:

            metrics.total_supply

            ?

            percent(

                metrics.circulating_supply /

                metrics.total_supply *

                100

            )

            :

            0,





        /*
        ===============================
           VALUATION
        ===============================
        */


        market_cap:

            number(
                metrics.market_cap
            ),


        fdv:

            number(
                metrics.fdv
            ),





        /*
        ===============================
           SCORE
        ===============================
        */


        tokenomics_score:

            score


    };

}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanTokenomics,


    calculateTokenomicsScore,


    calculateCirculationScore,


    calculateFDVScore

};