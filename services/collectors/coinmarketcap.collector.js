// =========================================
// services/coinmarketcap.collector.js
// =========================================

"use strict";


const axios = require("axios");



const API_KEY =
    process.env.COINMARKETCAP_API_KEY;



const BASE_URL =
    "https://pro-api.coinmarketcap.com";



/* =========================================
   HEADERS
========================================= */

function headers(){

    return {

        "X-CMC_PRO_API_KEY":
            API_KEY,

        Accept:
            "application/json"

    };

}



/* =========================================
   FIND TOKEN BY SYMBOL
========================================= */

async function getTokenBySymbol(symbol){


    if(!symbol){

        throw new Error(
            "Token symbol required"
        );

    }



    if(!API_KEY){

        throw new Error(
            "Missing COINMARKETCAP_API_KEY"
        );

    }



    const url =
        `${BASE_URL}/v1/cryptocurrency/quotes/latest`;



    const response =
        await axios.get(
            url,
            {
                headers: headers(),

                params: {

                    symbol:
                        symbol.toUpperCase(),

                    convert:
                        "USD"

                }

            }
        );



    const data =
        response.data?.data;



    const token =
        data?.[symbol.toUpperCase()];



    if(!token){

        return null;

    }



    return normalizeToken(token);


}



/* =========================================
   NORMALIZE DATA
========================================= */


function normalizeToken(token){


    const quote =
        token.quote?.USD || {};



    return {


        id:
            token.id,


        name:
            token.name,


        symbol:
            token.symbol,



        price:

            Number(
                quote.price || 0
            ),



        market_cap:

            Number(
                quote.market_cap || 0
            ),



        volume_24h:

            Number(
                quote.volume_24h || 0
            ),



        percent_change_24h:

            Number(
                quote.percent_change_24h || 0
            ),



        circulating_supply:

            Number(
                token.circulating_supply || 0
            ),



        total_supply:

            Number(
                token.total_supply || 0
            ),



        max_supply:

            Number(
                token.max_supply || 0
            ),



        cmc_rank:

            token.cmc_rank || null


    };


}



/* =========================================
   GET MARKET DATA
========================================= */


async function getMarketData(symbol){


    const token =
        await getTokenBySymbol(symbol);



    if(!token){

        return null;

    }



    return {


        token_symbol:
            token.symbol,


        current_price:
            token.price,


        market_cap:
            token.market_cap,


        total_supply:
            token.total_supply,


        circulating_supply:
            token.circulating_supply,


        max_supply:
            token.max_supply,


        volume_24h:
            token.volume_24h,


        change_24h:
            token.percent_change_24h,


        rank:
            token.cmc_rank


    };


}



/* =========================================
   EXPORTS
========================================= */


module.exports = {


    getTokenBySymbol,

    getMarketData,

    normalizeToken


};