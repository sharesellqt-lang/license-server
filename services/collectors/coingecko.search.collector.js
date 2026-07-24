"use strict";

const axios = require("axios");


const BASE =
    "https://api.coingecko.com/api/v3";


/*
=========================================
SEARCH COIN
=========================================
*/

async function searchCoin(query){

    if(!query){

        throw new Error(
            "Missing search query"
        );

    }


    const url =
        `${BASE}/search`;


    try{


        const response =
            await axios.get(

                url,

                {
                    params:{
                        query
                    },

                    timeout:10000
                }

            );


        const coins =
            response.data?.coins || [];


        if(
            !coins.length
        ){

            return null;

        }



        /*
        =====================================
        ƯU TIÊN MATCH EXACT
        =====================================
        */


        const lower =
            query.toLowerCase();



        let coin =
            coins.find(
                c =>
                c.symbol?.toLowerCase()
                ===
                lower
            );



        if(!coin){

            coin =
            coins[0];

        }



        return {

            id:
                coin.id,


            symbol:
                coin.symbol,


            name:
                coin.name,


            thumb:
                coin.thumb

        };


    }
    catch(err){


        console.log(
            "========== COINGECKO SEARCH ERROR =========="
        );


        if(err.response){

            console.log(
                "STATUS:",
                err.response.status
            );

            console.log(
                err.response.data
            );

        }


        throw err;

    }


}



/*
=========================================
SEARCH BY CONTRACT
=========================================
*/


async function searchByContract(
    platform,
    address
){

    const url =
        `${BASE}/coins/${platform}/contract/${address}`;


    try{


        const response =
            await axios.get(

                url,

                {
                    timeout:10000
                }

            );


        const data =
            response.data;


        if(!data){

            return null;

        }



        return {

            id:
                data.id,


            symbol:
                data.symbol,


            name:
                data.name,


            market_data:
                data.market_data || {}

        };


    }
    catch(err){


        if(err.response){

            console.log(
                "CoinGecko Contract:",
                err.response.status
            );

        }


        return null;

    }


}



module.exports = {


    searchCoin,


    searchByContract


};