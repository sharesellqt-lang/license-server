// =========================================
// services/scan/scan.geckoterminal.js
// =========================================

"use strict";


const geckoTerminalCollector =
    require("../collectors/geckoterminal.collector");



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




/* =========================================
   EXTRACT TOKEN INFO
========================================= */


function extractTokenInfo(
    project={}
){

    return {


        network:

            project.network ||

            project.chain ||

            project.blockchain ||

            "",



        token_address:

            project.token_address ||

            project.contract_address ||

            project.token_contract ||

            "",



        pool_address:

            project.pool_address ||

            project.dex_pool ||

            ""

    };

}




/* =========================================
   LIQUIDITY SCORE
========================================= */


function calculateLiquidityScore(
    data={}
){

    let score = 0;



    const liquidity =
        number(
            data.liquidity
        );


    const volume =
        number(
            data.volume_24h
        );



    /*
    ===============================
       LIQUIDITY
    ===============================
    */


    if(
        liquidity >= 10000000
    ){

        score += 40;

    }

    else if(
        liquidity >= 1000000
    ){

        score += 30;

    }

    else if(
        liquidity >= 100000
    ){

        score += 15;

    }



    /*
    ===============================
       VOLUME
    ===============================
    */


    if(
        volume >= 10000000
    ){

        score += 30;

    }

    else if(
        volume >= 1000000
    ){

        score += 20;

    }

    else if(
        volume >= 100000
    ){

        score += 10;

    }




    /*
    ===============================
       MARKET HEALTH
    ===============================
    */


    if(
        data.market_cap &&
        data.fdv
    ){

        const ratio =
            data.fdv /
            data.market_cap;


        if(
            ratio <= 2
        ){

            score += 20;

        }

        else if(
            ratio <= 5
        ){

            score += 10;

        }

    }




    /*
    ===============================
       PRICE MOMENTUM
    ===============================
    */


    if(
        number(data.price_change_24h) > 0
    ){

        score += 10;

    }



    return Math.min(
        score,
        100
    );

}





/* =========================================
   SCAN GECKOTERMINAL
========================================= */


async function scanGeckoTerminal(
    context={}
){


    const project =
        context.project || {};



    const info =
        extractTokenInfo(
            project
        );



    /*
    =====================================
       MISSING DATA
    =====================================
    */


    if(

        !info.network ||

        !info.token_address

    ){


        return {


            listed:false,


            onchain_score:0,


            geckoterminal_score:0,


            message:

                "GeckoTerminal token info missing"


        };


    }




    const result =
        await geckoTerminalCollector.fetchToken(

            info.network,

            info.token_address

        );





 if(
    !result ||
    Object.keys(result).length === 0
){

    return {

        listed:false,

        onchain_score:0,

        geckoterminal_score:0,

        liquidity:0,

        volume_24h:0,

        market_cap:0,

        fdv:0

    };

}





    const score =
        calculateLiquidityScore(
            result
        );





    return {


        /*
        ===============================
           BASIC
        ===============================
        */


        network:

            info.network,


        token_address:

            info.token_address,



        token_symbol:

            result.token_symbol || "",




        /*
        ===============================
           MARKET
        ===============================
        */


        current_price:

            number(
                result.current_price
            ),


        market_cap:

            number(
                result.market_cap
            ),


        fdv:

            number(
                result.fdv
            ),





        /*
        ===============================
           LIQUIDITY
        ===============================
        */


        liquidity:

            number(
                result.liquidity
            ),


        volume_24h:

            number(
                result.volume_24h
            ),




        /*
        ===============================
           SUPPLY
        ===============================
        */


        total_supply:

            number(
                result.total_supply
            ),


        circulating_supply:

            number(
                result.circulating_supply
            ),


        max_supply:

            number(
                result.max_supply
            ),





        /*
        ===============================
           PRICE ACTION
        ===============================
        */


        price_change_24h:

            number(
                result.price_change_24h
            ),




        /*
        ===============================
           SCORE
        ===============================
        */


        geckoterminal_score:

            score,


        onchain_score:

            score


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanGeckoTerminal,


    calculateLiquidityScore,


    extractTokenInfo


};