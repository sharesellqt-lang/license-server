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
        `${BASE_URL}/networks/${apiNetwork}/tokens/${tokenAddress}/pools`;


    console.log("========== GECKOTERMINAL ==========");
    console.log("NETWORK :", network);
    console.log("API     :", apiNetwork);
    console.log("TOKEN   :", tokenAddress);


    try{


        const response =
            await axios.get(
                url,
                {
                    timeout:10000,

                    headers:{
                        accept:
                        "application/json"
                    }

                }
            );


        const pools =
            response.data?.data || [];



        if(
            pools.length === 0
        ){

            console.log(
                "NO POOL FOUND"
            );

            return {};

        }



        /*
        chọn pool có liquidity lớn nhất
        */

        const pool =

            pools.sort(

                (a,b)=>{

                    const la =
                        Number(
                            a.attributes?.reserve_in_usd || 0
                        );

                    const lb =
                        Number(
                            b.attributes?.reserve_in_usd || 0
                        );


                    return lb-la;

                }

            )[0];




        const attr =
            pool.attributes || {};




        const result = {


            token_symbol:

                attr.base_token_symbol ||
                "",



            current_price:

                number(
                    attr.base_token_price_usd
                ),



            market_cap:

                number(
                    attr.market_cap_usd
                ),



            fdv:

                number(
                    attr.fdv_usd
                ),



            liquidity:

                number(
                    attr.reserve_in_usd
                ),



            volume_24h:

                number(
                    attr.volume_usd?.h24
                ),



            price_change_24h:

                number(
                    attr.price_change_percentage?.h24
                )


        };



        console.table({

            price:
                result.current_price,

            market_cap:
                result.market_cap,

            fdv:
                result.fdv,

            liquidity:
                result.liquidity,

            volume:
                result.volume_24h

        });



        return result;



    }
    catch(err){


        console.log(
            "========== GECKOTERMINAL ERROR =========="
        );


        console.log(
            err.response?.status ||
            err.message
        );


        return {};

    }

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    fetchToken

};