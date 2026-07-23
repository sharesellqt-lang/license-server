// =========================================
// services/collectors/coingecko.collector.js
// =========================================

"use strict";

const axios = require("axios");


const BASE_URL =
    "https://api.coingecko.com/api/v3";


/* =========================================
   GET TOKEN DATA BY COINGECKO ID
========================================= */

async function fetchById(
    coinId
) {

    if (!coinId) {

        throw new Error(
            "CoinGecko id is required"
        );

    }

    const url =
        `${BASE_URL}/coins/${coinId}`;

    console.log(
        "CoinGecko URL:",
        url
    );

    try {

        const response =
            await axios.get(
                url,
                {
                    params: {

                        localization: false,

                        tickers: false,

                        market_data: true,

                        community_data: false,

                        developer_data: false,

                        sparkline: false

                    },

                    timeout: 10000
                }
            );

        console.log(
            "CoinGecko status:",
            response.status
        );

        console.log(
            "CoinGecko symbol:",
            response.data.symbol
        );

        const data =
            response.data;

        const market =
            data.market_data || {};

        return {

            // =========================
            // BASIC
            // =========================

            token_symbol:
                data.symbol
                    ? data.symbol.toUpperCase()
                    : "",

            name:
                data.name || "",

            // =========================
            // PRICE
            // =========================

            current_price:
                market.current_price?.usd || 0,

            // =========================
            // MARKET CAP
            // =========================

            market_cap:
                market.market_cap?.usd || 0,

            // =========================
            // FDV
            // =========================

            fdv:
                market.fully_diluted_valuation?.usd || 0,

            // =========================
            // SUPPLY
            // =========================

            total_supply:
                market.total_supply || 0,

            circulating_supply:
                market.circulating_supply || 0,

            max_supply:
                market.max_supply || 0,

            // =========================
            // ATH / ATL
            // =========================

            ath_price:
                market.ath?.usd || 0,

            atl_price:
                market.atl?.usd || 0,

            // =========================
            // VOLUME
            // =========================

            volume_24h:
                market.total_volume?.usd || 0,

            price_change_24h:
                market.price_change_percentage_24h || 0,

            price_change_7d:
                market.price_change_percentage_7d || 0,

            price_change_30d:
                market.price_change_percentage_30d || 0

        };

    }
    catch (err) {

        console.log(
            "=============================="
        );

        console.log(
            "CoinGecko ERROR"
        );

        console.log(
            "Status:",
            err.response?.status
        );

        console.log(
            "Body:",
            err.response?.data
        );

        console.log(
            "Message:",
            err.message
        );

        console.log(
            "=============================="
        );

        throw err;

    }

}


/* =========================================
   SEARCH COIN BY NAME
========================================= */

async function searchCoin(
    keyword
) {


    if (!keyword) {

        return [];

    }


    const url =
        `${BASE_URL}/search`;


    const response =
        await axios.get(

            url,

            {
                params: {

                    query: keyword

                },

                timeout: 10000
            }

        );


    return (

        response.data.coins
        ||
        []

    ).map(
        coin => ({

            id:
                coin.id,

            name:
                coin.name,

            symbol:
                coin.symbol

        })

    );

}


/* =========================================
   FETCH BY SYMBOL
========================================= */

async function fetchBySymbol(
    symbol
) {


    const coins =
        await searchCoin(symbol);


    if (!coins.length) {

        return null;

    }


    return fetchById(
        coins[0].id
    );


}


/* =========================================
   EXPORT
========================================= */

module.exports = {


    fetchById,

    fetchBySymbol,

    searchCoin


};