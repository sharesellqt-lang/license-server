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

        /* =====================================
           SUPPLY
        ===================================== */

        const totalSupply =
            Number(
                attr.normalized_total_supply ||
                attr.total_supply ||
                0
            );

        let circulatingSupply = 0;

        if(attr.circulating_supply){

            circulatingSupply =
                Number(
                    attr.circulating_supply
                );

        }
        else if(

            attr.market_cap_usd &&
            attr.price_usd

        ){

            circulatingSupply =

                Number(attr.market_cap_usd)

                /

                Number(attr.price_usd);

        }

        let maxSupply =

            Number(
                attr.max_supply || 0
            );

        if(

            maxSupply === 0 &&
            totalSupply > 0

        ){

            maxSupply =
                totalSupply;

        }

        console.log(
            "========== ATTR =========="
        );

        console.log(
            JSON.stringify(
                attr,
                null,
                2
            )
        );

        console.log({

            total_supply:
                totalSupply,

            circulating_supply:
                circulatingSupply,

            max_supply:
                maxSupply

        });

        return {

            /* =========================
               BASIC
            ========================= */

            token_symbol:
                attr.symbol || "",

            /* =========================
               PRICE
            ========================= */

            current_price:
                Number(
                    attr.price_usd ||

                    attr.base_token_price_usd ||

                    0
                ),

            /* =========================
               SUPPLY
            ========================= */

            total_supply:
                totalSupply,

            circulating_supply:
                circulatingSupply,

            max_supply:
                maxSupply,

            /* =========================
               MARKET
            ========================= */

            market_cap:
                Number(
                    attr.market_cap_usd || 0
                ),

            fdv:
                Number(
                    attr.fdv_usd || 0
                ),

            /* =========================
               VOLUME
            ========================= */

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

        if(err.response){

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