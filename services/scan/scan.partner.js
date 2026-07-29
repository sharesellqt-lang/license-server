"use strict";

/*
=========================================
 SERVICES / SCAN / SCAN.PARTNER.JS

 Partner Intelligence Scanner

 Input:
    projectId

 Output:
    partner_score

 Data:
    partner.repository.js

=========================================
*/


const partnerRepository =
    require("../../repositories/partner.repository");



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



function normalize(value){

    return String(
        value || ""
    )
    .toLowerCase();

}





/* =========================================
   IMPORTANT PARTNERS
========================================= */


const PREMIUM_PARTNERS = [

    "binance",

    "coinbase",

    "okx",

    "bybit",

    "kraken",

    "ethereum",

    "polygon",

    "arbitrum",

    "optimism",

    "solana",

    "avalanche",

    "chainlink",

    "google",

    "microsoft",

    "aws",

    "layerzero",

    "wormhole",

    "celer",

    "walletconnect"

];





/* =========================================
   CALCULATE PARTNER SCORE
========================================= */


function calculatePartnerScore(
    partners = []
){

    if(

        !Array.isArray(partners)

        ||

        partners.length === 0

    ){

        return 0;

    }



    let score = 0;




    /*
    =====================================
       NUMBER OF PARTNERS
    =====================================
    */


    const count =
        partners.length;



    if(
        count >= 10
    ){

        score += 20;

    }

    else if(
        count >= 5
    ){

        score += 15;

    }

    else if(
        count >= 2
    ){

        score += 8;

    }





    /*
    =====================================
       PREMIUM PARTNER
    =====================================
    */


    let premiumCount = 0;



    partners.forEach(partner=>{


        const name =

            normalize(

                partner.name ||

                partner.company ||

                partner.partner

            );



        if(

            PREMIUM_PARTNERS.some(

                item =>

                name.includes(item)

            )

        ){

            premiumCount++;

        }


    });





    if(
        premiumCount >= 5
    ){

        score += 40;

    }

    else if(
        premiumCount >= 3
    ){

        score += 30;

    }

    else if(
        premiumCount >= 1
    ){

        score += 15;

    }





    /*
    =====================================
       PARTNER TYPE
    =====================================
    */


    let exchange = 0;

    let ecosystem = 0;

    let technology = 0;



    partners.forEach(partner=>{


        const type =

            normalize(

                partner.type ||

                partner.category

            );



        if(

            type.includes("exchange")

            ||

            type.includes("listing")

        ){

            exchange++;

        }



        if(

            type.includes("ecosystem")

            ||

            type.includes("chain")

        ){

            ecosystem++;

        }



        if(

            type.includes("technology")

            ||

            type.includes("infra")

        ){

            technology++;

        }


    });





    if(exchange > 0){

        score += 15;

    }


    if(ecosystem > 0){

        score += 10;

    }


    if(technology > 0){

        score += 10;

    }





    /*
    =====================================
       VERIFIED LINKS
    =====================================
    */


    let verified = 0;



    partners.forEach(partner=>{


        if(

            partner.website ||

            partner.url ||

            partner.twitter

        ){

            verified++;

        }


    });





    if(
        verified >= 5
    ){

        score += 15;

    }

    else if(
        verified >= 2
    ){

        score += 8;

    }





    return Math.min(

        Math.round(score),

        100

    );


}







/* =========================================
   SCAN PARTNER
========================================= */


async function scanPartner(
    context={}
){

    const projectId =
        context.projectId;



    if(!projectId){

      return {

partner_score,

partners,

partner_count

}

    }





    const partners =

        await partnerRepository.getByProject(

            projectId

        );





    const score =

        calculatePartnerScore(

            partners

        );





    return {


        /*
        ===============================
           DATA
        ===============================
        */


        partner_count:

            partners.length,



        partners:

            partners.map(partner=>({

                name:

                    partner.name || "",


                type:

                    partner.type || "",


                website:

                    partner.website || "",


                verified:

                    !!(

                        partner.website ||

                        partner.url

                    )


            })),





        /*
        ===============================
           SCORE
        ===============================
        */


        partner_score:

            score


    };


}






/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanPartner,


    calculatePartnerScore


};