// =========================================
// services/collectors/coinmarketcap.collector.js
// =========================================

"use strict";

const axios = require("axios");

const BASE_URL =
    "https://pro-api.coinmarketcap.com/v1";

const API_KEY =
    process.env.COINMARKETCAP_API_KEY;

/* =========================================
   AXIOS
========================================= */

const api = axios.create({

    baseURL: BASE_URL,

    timeout: 10000,

    headers: {

        Accept: "application/json",

        "X-CMC_PRO_API_KEY":
            API_KEY

    }

});

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

/* =========================================
   NORMALIZE
========================================= */

function normalizeToken(token){

    if(!token){

        return {};

    }

    const quote =
        token.quote?.USD || {};

    return {

        token_symbol:

            token.symbol || "",

        name:

            token.name || "",

        current_price:

            number(
                quote.price
            ),

        market_cap:

            number(
                quote.market_cap
            ),

        volume_24h:

            number(
                quote.volume_24h
            ),

        fdv:

            number(
                quote.fully_diluted_market_cap
            ),

        circulating_supply:

            number(
                token.circulating_supply
            ),

        total_supply:

            number(
                token.total_supply
            ),

        max_supply:

            number(
                token.max_supply
            ),

        cmc_rank:

            number(
                token.cmc_rank
            ),

        price_change_24h:

            number(
                quote.percent_change_24h
            ),

        price_change_7d:

            number(
                quote.percent_change_7d
            ),

        price_change_30d:

            number(
                quote.percent_change_30d
            )

    };

}

/* =========================================
   FETCH BY SYMBOL
========================================= */

async function fetchBySymbol(symbol){

    if(!symbol){

        return {};

    }

    if(!API_KEY){

        console.log(
            "CoinMarketCap API key missing."
        );

        return {};

    }

    try{

        const res =
            await api.get(

                "/cryptocurrency/quotes/latest",

                {

                    params:{

                        symbol:
                            symbol.toUpperCase(),

                        convert:
                            "USD"

                    }

                }

            );

        const token =

            res.data?.data?.[
                symbol.toUpperCase()
            ];

        if(!token){

            return {};

        }

        return normalizeToken(token);

    }

    catch(err){

        console.log(
            "========== COINMARKETCAP ERROR =========="
        );

        console.log(
            "Status:",
            err.response?.status
        );

        console.log(
            "Message:",
            err.message
        );

        if(

            err.response?.status === 429

        ){

            console.log(
                "CoinMarketCap rate limit."
            );

            return {};

        }

        if(

            err.response?.status === 401

        ){

            console.log(
                "CoinMarketCap invalid API key."
            );

            return {};

        }

        return {};

    }

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchBySymbol,

    normalizeToken

};