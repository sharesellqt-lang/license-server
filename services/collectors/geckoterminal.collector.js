"use strict";

const axios = require("axios");

const BASE =
    "https://api.geckoterminal.com/api/v2";

/* =========================================
   FETCH TOKEN
========================================= */

async function fetchToken(
    network,
    tokenAddress
){

    const url =
`${BASE}/networks/${network}/tokens/${tokenAddress}`;

    try{

        const response =
            await axios.get(
                url,
                {
                    timeout:10000
                }
            );

        console.log(
            JSON.stringify(
                response.data,
                null,
                2
            )
        );

        if(

            !response.data ||

            !response.data.data

        ){

            throw new Error(
                "Token not found"
            );

        }

        const token =
            response.data.data;

        const attr =
            token.attributes || {};

        console.log({

            total_supply:
                attr.total_supply,

            normalized_total_supply:
                attr.normalized_total_supply,

            circulating_supply:
                attr.circulating_supply,

            max_supply:
                attr.max_supply

        });

        return {

            token_symbol:
                attr.symbol || "",

            current_price:
                Number(
                    attr.price_usd ||

                    attr.base_token_price_usd ||

                    0
                ),

            total_supply:
                Number(

                    attr.normalized_total_supply ||

                    attr.total_supply ||

                    0

                ),

            circulating_supply:
                Number(

                    attr.circulating_supply ||

                    attr.normalized_total_supply ||

                    attr.total_supply ||

                    0

                ),

            max_supply:
                Number(

                    attr.max_supply ||

                    attr.normalized_total_supply ||

                    attr.total_supply ||

                    0

                ),

            market_cap:
                Number(
                    attr.market_cap_usd || 0
                ),

            fdv:
                Number(
                    attr.fdv_usd || 0
                ),

            volume_24h:
                Number(
                    attr.volume_usd?.h24 || 0
                ),

            liquidity:
                Number(

                    attr.total_reserve_in_usd ||

                    attr.reserve_in_usd ||

                    0

                ),

            price_change_24h:
                Number(
                    attr.price_change_percentage?.h24 || 0
                )

        };

    }
    catch(err){

        if(

            err.response

        ){

            console.log(
                "========== GECKOTERMINAL ERROR =========="
            );

            console.log(
                "Status:",
                err.response.status
            );

            console.log(
                JSON.stringify(
                    err.response.data,
                    null,
                    2
                )
            );

            if(

                err.response.status === 429

            ){

                throw new Error(
                    "GeckoTerminal rate limit"
                );

            }

        }

        throw err;

    }

}

module.exports = {

    fetchToken

};