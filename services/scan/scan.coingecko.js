// =========================================
// services/scan/scan.coingecko.js
// =========================================

"use strict";


const coingeckoCollector =
    require("../collectors/coingecko.collector");



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
   EXTRACT COINGECKO ID
========================================= */


function extractCoinId(
    project={}
){

    return (

        project.coingecko_id ||

        project.coin_id ||

        project.token_id ||

        ""

    );

}



/* =========================================
   TOKEN SCORE
========================================= */


function calculateTokenScore(
    data={}
){

    let score = 0;



    const marketCap =
        number(
            data.market_cap
        );


    const fdv =
        number(
            data.fdv
        );


    const volume =
        number(
            data.volume_24h
        );


    const circulating =
        number(
            data.circulating_supply
        );


    const total =
        number(
            data.total_supply
        );



    /*
    =====================================
       MARKET CAP
    =====================================
    */


    if(
        marketCap >= 1000000000
    ){

        score += 25;

    }
    else if(
        marketCap >= 100000000
    ){

        score += 18;

    }
    else if(
        marketCap >= 10000000
    ){

        score += 10;

    }



    /*
    =====================================
       VOLUME
    =====================================
    */


    if(
        volume >= 50000000
    ){

        score += 20;

    }
    else if(
        volume >= 10000000
    ){

        score += 12;

    }
    else if(
        volume >= 1000000
    ){

        score += 5;

    }




    /*
    =====================================
       SUPPLY HEALTH
    =====================================
    */


    if(
        total > 0 &&
        circulating > 0
    ){

        const ratio =
            circulating /
            total;



        if(
            ratio >= 0.7
        ){

            score += 20;

        }

        else if(
            ratio >= 0.4
        ){

            score += 10;

        }

    }



    /*
    =====================================
       FDV GAP
    =====================================
    */


    if(
        fdv > 0 &&
        marketCap > 0
    ){

        const gap =
            fdv /
            marketCap;


        if(
            gap <= 1.5
        ){

            score += 20;

        }

        else if(
            gap <= 3
        ){

            score += 10;

        }

    }



    /*
    =====================================
       PRICE MOMENTUM
    =====================================
    */


    if(
        number(data.price_change_30d) > 10
    ){

        score += 15;

    }



    return Math.min(
        score,
        100
    );

}





/* =========================================
   SCAN COINGECKO
========================================= */


async function scanCoinGecko(
    context={}
){

    const project =
        context.project || {};



    const coinId =
        extractCoinId(
            project
        );



    /*
    =====================================
       MISSING ID
    =====================================
    */


    if(!coinId){


        return {


            coingecko_id:"",


            listed:false,


            token_score:0,


            message:
                "CoinGecko id missing"


        };


    }





    const data =
        await coingeckoCollector.fetchById(
            coinId
        );



    if(!data){


        return {


            listed:false,


            token_score:0


        };


    }





    const tokenScore =
        calculateTokenScore(
            data
        );





    return {


        /*
        ===============================
           BASIC
        ===============================
        */


        coingecko_id:

            coinId,


        token_symbol:

            data.token_symbol || "",


        token_name:

            data.name || "",





        /*
        ===============================
           MARKET
        ===============================
        */


        current_price:

            number(
                data.current_price
            ),


        market_cap:

            number(
                data.market_cap
            ),


        fdv:

            number(
                data.fdv
            ),


        volume_24h:

            number(
                data.volume_24h
            ),




        /*
        ===============================
           SUPPLY
        ===============================
        */


        total_supply:

            number(
                data.total_supply
            ),


        circulating_supply:

            number(
                data.circulating_supply
            ),


        max_supply:

            number(
                data.max_supply
            ),




        /*
        ===============================
           PRICE HISTORY
        ===============================
        */


        ath_price:

            number(
                data.ath_price
            ),


        atl_price:

            number(
                data.atl_price
            ),


        price_change_24h:

            number(
                data.price_change_24h
            ),


        price_change_7d:

            number(
                data.price_change_7d
            ),


        price_change_30d:

            number(
                data.price_change_30d
            ),




        /*
        ===============================
           SCORE
        ===============================
        */


        token_score:

            tokenScore,


        market_score:

            tokenScore


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanCoinGecko,


    calculateTokenScore,


    extractCoinId


};