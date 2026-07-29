// =========================================
// services/scan/scan.defillama.js
// =========================================

"use strict";


const defiLlamaCollector =
    require("../collectors/defillama.collector");



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



/*
=========================================
EXTRACT DEFILLAMA SLUG
=========================================
*/


function extractSlug(
    project={}
){

    return (

        project.defillama_slug ||

        project.defillama_id ||

        project.defi_slug ||

        ""

    );

}



/* =========================================
   SCAN DEFILLAMA
========================================= */


async function scanDefiLlama(
    context={}
){


    const project =
        context.project || {};



    const slug =
        extractSlug(
            project
        );



    /*
    =====================================
       NO DEFILLAMA DATA
    =====================================
    */


    if(!slug){


        return {


            defillama_slug:"",


            listed:false,


            tvl:0,


            tvl_growth:0,


            defillama_score:0,


            message:

                "DefiLlama slug missing"


        };


    }





    const result =
        await defiLlamaCollector.fetchProtocol(
            slug
        );



    if(!result){


        return {


            listed:false,


            defillama_score:0


        };


    }





    return {


        /*
        ===============================
           BASIC
        ===============================
        */


        defillama_slug:

            result.defillama_slug || slug,


        protocol_name:

            result.protocol_name || "",


        protocol_category:

            result.protocol_category || "",



        protocol_chains:

            result.protocol_chains || [],




        /*
        ===============================
           FINANCIAL
        ===============================
        */


        tvl:

            number(
                result.tvl
            ),


        tvl_growth:

            number(
                result.tvl_growth
            ),



        tvl_history_points:

            number(
                result.tvl_history_points
            ),




        /*
        ===============================
           SECURITY
        ===============================
        */


        audits:

            result.audits || [],


        audit_count:

            number(
                result.audit_count
            ),




        /*
        ===============================
           SOCIAL / INFO
        ===============================
        */


        website:

            result.website || "",


        github:

            result.github || [],


        twitter:

            result.twitter || "",




        /*
        ===============================
           SCORE
        ===============================
        */


        financial_score:

            number(
                result.defillama_score
            ),


        defillama_score:

            number(
                result.defillama_score
            )


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanDefiLlama,


    extractSlug


};