"use strict";

/*
=========================================
 services/scan/scan.onchain.js
=========================================

ONCHAIN INTELLIGENCE SCANNER


Sources:

- GeckoTerminal
- CoinGecko
- Existing Metrics


Output:

{
    holders,
    transactions_24h,
    liquidity,
    price_change_24h,
    onchain_score,
    risk_score
}


=========================================
*/


/* =====================================
   HELPERS
===================================== */


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





/* =====================================
   ONCHAIN SCORE
===================================== */


function calculateOnchainScore(
    data = {}
){


    let score = 0;



    /*
    ===============================
       LIQUIDITY
    ===============================
    */


    const liquidity =
        number(
            data.liquidity
        );



    if(
        liquidity >= 10000000
    ){

        score += 30;

    }

    else if(
        liquidity >= 1000000
    ){

        score += 20;

    }

    else if(
        liquidity >= 100000
    ){

        score += 10;

    }




    /*
    ===============================
       HOLDERS
    ===============================
    */


    const holders =
        number(
            data.holders
        );



    if(
        holders >= 100000
    ){

        score += 25;

    }

    else if(
        holders >= 10000
    ){

        score += 18;

    }

    else if(
        holders >= 1000
    ){

        score += 10;

    }




    /*
    ===============================
       TRANSACTION ACTIVITY
    ===============================
    */


    const tx =
        number(
            data.transactions_24h
        );



    if(
        tx >= 50000
    ){

        score += 20;

    }

    else if(
        tx >= 10000
    ){

        score += 15;

    }

    else if(
        tx >= 1000
    ){

        score += 8;

    }





    /*
    ===============================
       PRICE HEALTH
    ===============================
    */


    const change =
        number(
            data.price_change_24h
        );



    if(
        change > 0 &&
        change < 20
    ){

        score += 10;

    }


    else if(
        change >= 20
    ){

        score += 5;

    }





    /*
    ===============================
       LIMIT
    ===============================
    */


    return Math.min(
        score,
        100
    );


}







/* =====================================
   RISK SCORE
===================================== */


function calculateRiskScore(
    data={}
){


    let risk = 0;



    /*
    LOW LIQUIDITY
    */


    if(
        number(data.liquidity)
        <
        100000
    ){

        risk += 30;

    }




    /*
    LOW HOLDERS
    */


    if(
        number(data.holders)
        <
        1000
    ){

        risk += 25;

    }





    /*
    LOW ACTIVITY
    */


    if(
        number(data.transactions_24h)
        <
        100
    ){

        risk += 20;

    }





    /*
    PRICE VOLATILITY
    */


    const change =
        Math.abs(

            number(
                data.price_change_24h
            )

        );



    if(
        change > 30
    ){

        risk += 25;

    }



    return Math.min(
        risk,
        100
    );


}







/* =====================================
   RISK LEVEL
===================================== */


function riskLevel(score){


    if(score >= 80){

        return "very-high";

    }


    if(score >= 60){

        return "high";

    }


    if(score >= 40){

        return "medium";

    }


    if(score >= 20){

        return "low";

    }


    return "very-low";


}







/* =====================================
   MAIN SCANNER
===================================== */


async function scanOnchain(
    context={}
){


    const project =
        context.project || {};



    const gecko =
        context.geckoterminal
        ||
        {};



    const coin =
        context.coingecko
        ||
        {};



    const metrics =
        context.metrics
        ||
        {};





    /*
    =================================
       MERGE DATA
    =================================
    */


    const onchain = {



        holders:

            number(

                gecko.holders

                ||

                coin.holders

                ||

                metrics.holders

            ),




        transactions_24h:

            number(

                gecko.transactions_24h

                ||

                gecko.tx_count

                ||

                metrics.transactions_24h

            ),




        liquidity:

            number(

                gecko.liquidity

                ||

                metrics.liquidity

            ),




        price_change_24h:

            number(

                gecko.price_change_24h

                ||

                coin.price_change_24h

                ||

                metrics.price_change_24h

            )



    };







    const score =

        calculateOnchainScore(
            onchain
        );





    const risk =

        calculateRiskScore(
            onchain
        );







    return {


        project_id:

            project.id,



        ...onchain,



        onchain_score:

            score,



        risk_score:

            risk,



        risk_level:

            riskLevel(
                risk
            )



    };


}






module.exports = {


    scanOnchain,


    calculateOnchainScore,


    calculateRiskScore,


    riskLevel


};