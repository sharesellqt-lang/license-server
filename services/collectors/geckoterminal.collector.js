// =========================================
// services/collectors/geckoterminal.collector.js
// =========================================

"use strict";

const axios = require("axios");

const BASE_URL =
    "https://api.geckoterminal.com/api/v2";

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

function mapNetwork(network = ""){

    switch(String(network).toLowerCase()){

        case "eth":
        case "ethereum":
            return "ethereum";

        case "bsc":
        case "bnb":
            return "bsc";

        case "polygon":
        case "matic":
            return "polygon_pos";

        case "arb":
        case "arbitrum":
            return "arbitrum";

        case "op":
        case "optimism":
            return "optimism";

        case "avax":
        case "avalanche":
            return "avalanche";

        case "base":
            return "base";

        case "sol":
        case "solana":
            return "solana";

        default:
            return String(network).toLowerCase();

    }

}

/* =========================================
   FETCH TOKEN
========================================= */

async function fetchToken(
    network,
    tokenAddress
){

    if(!network || !tokenAddress){

        return {};

    }

    const apiNetwork =
        mapNetwork(network);

    const url =
        `${BASE_URL}/networks/${apiNetwork}/tokens/${tokenAddress}`;

    console.log("========== GECKOTERMINAL ==========");
    console.log("NETWORK :", network);
    console.log("API     :", apiNetwork);
    console.log("TOKEN   :", tokenAddress);

    try{

        const response =
            await axios.get(
                url,
                {
                    timeout:10000
                }
            );

        const token =
            response.data?.data;

        if(!token){

            return {};

        }

        const attr =
            token.attributes || {};

        /* =====================================
           SUPPLY
        ===================================== */

        const totalSupply =
            number(

                attr.normalized_total_supply ||

                attr.total_supply

            );

        let circulatingSupply =

            number(
                attr.circulating_supply
            );

        if(

            circulatingSupply <= 0 &&

            number(attr.market_cap_usd) > 0 &&

            number(attr.price_usd) > 0

        ){

            circulatingSupply =

                number(attr.market_cap_usd)

                /

                number(attr.price_usd);

        }

        let maxSupply =
            number(attr.max_supply);

        if(

            maxSupply <= 0 &&

            totalSupply > 0

        ){

            maxSupply =
                totalSupply;

        }

        if(

            totalSupply > 0 &&

            circulatingSupply > totalSupply

        ){

            circulatingSupply =
                totalSupply;

        }

        if(

            circulatingSupply <= 0 &&

            totalSupply > 0

        ){

            circulatingSupply =
                totalSupply;

        }

        /* =====================================
           NORMALIZED DATA
        ===================================== */

        const result = {

            token_symbol:

                attr.symbol || "",

            current_price:

                number(

                    attr.price_usd ||

                    attr.base_token_price_usd ||

                    attr.price

                ),

            total_supply:

                totalSupply,

            circulating_supply:

                circulatingSupply,

            max_supply:

                maxSupply,

            market_cap:

                number(

                    attr.market_cap_usd ||

                    attr.market_cap ||

                    attr.fdv_usd

                ),

            fdv:

                number(
                    attr.fdv_usd
                ),

            volume_24h:

                number(

                    attr.volume_usd?.h24 ||

                    attr.volume_usd?.["24h"] ||

                    attr.volume_24h

                ),

            liquidity:

                number(

                    attr.total_reserve_in_usd ||

                    attr.reserve_in_usd ||

                    attr.liquidity_usd

                ),

            price_change_24h:

                number(

                    attr.price_change_percentage?.h24 ||

                    attr.price_change_percentage?.["24h"]

                )

        };

        console.table({

            price:

                result.current_price,

            market_cap:

                result.market_cap,

            fdv:

                result.fdv,

            volume:

                result.volume_24h,

            liquidity:

                result.liquidity

        });

        return result;

    }

    catch(err){

        console.log(
            "========== GECKOTERMINAL ERROR =========="
        );

        if(err.response){

            console.log(
                "Status :",
                err.response.status
            );

            if(err.response.status === 404){

                console.log(
                    "Token not found."
                );

            }

            else if(err.response.status === 429){

                console.log(
                    "Rate limit reached."
                );

            }

            else{

                console.log(
                    err.response.data
                );

            }

        }

        else{

            console.log(
                err.message
            );

        }

        /*
        Không throw để tránh
        làm hỏng toàn bộ
        metrics pipeline.
        */

        return {};

    }

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    fetchToken

};