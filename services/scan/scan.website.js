// =========================================
// services/scan/scan.website.js
// =========================================

"use strict";


const fetch =
    global.fetch ||
    require("node-fetch");



/* =========================================
   HELPERS
========================================= */


function number(value){

    value =
        Number(value);


    return Number.isFinite(value)
        ? value
        : 0;

}



function normalizeUrl(url){

    if(!url){

        return null;

    }


    try{

        return new URL(url);

    }
    catch(_){

        return null;

    }

}



/*
=========================================
 CLEAN HTML TO TEXT
=========================================
*/

function extractVisibleText(
    html=""
){

    return String(html)

        .replace(
            /<script[\s\S]*?<\/script>/gi,
            " "
        )

        .replace(
            /<style[\s\S]*?<\/style>/gi,
            " "
        )

        .replace(
            /<svg[\s\S]*?<\/svg>/gi,
            " "
        )

        .replace(
            /<[^>]+>/g,
            " "
        )

        .replace(
            /&nbsp;/gi,
            " "
        )

        .replace(
            /\s+/g,
            " "
        )

        .trim();

}





/*
=========================================
 REQUEST
=========================================
*/


async function request(url){

    const controller =
        new AbortController();


    const timer =
        setTimeout(

            ()=>controller.abort(),

            10000

        );



    try{


        const res =
            await fetch(

                url,

                {

                    method:
                        "GET",


                    headers:{


                        "User-Agent":
                            "Airdrop-Intelligence/1.0",


                        "Accept":
                            "text/html"

                    },


                    signal:
                        controller.signal

                }

            );



        const text =
            await res.text();



        return {

            ok:
                res.ok,


            status:
                res.status,


            text

        };


    }
    catch(_){


        return {

            ok:false,


            status:0,


            text:""

        };


    }
    finally{


        clearTimeout(timer);


    }

}





/* =========================================
   SSL
========================================= */


function checkSSL(url){

    const parsed =
        normalizeUrl(url);


    return !!parsed &&
        parsed.protocol === "https:";

}





/* =========================================
   META
========================================= */


function extractMeta(
    html=""
){

    const text =
        html.toLowerCase();


    return {


        title:

            (
                html.match(
                    /<title>(.*?)<\/title>/i
                ) || []
            )[1]
            ||
            "",



        description:

            (
                html.match(
                    /<meta[^>]+name=["']description["'][^>]+content=["'](.*?)["']/i
                )
                ||
                []
            )[1]
            ||
            "",



        keywords:

            text.includes("crypto") ||
            text.includes("blockchain") ||
            text.includes("web3")

    };


}





/* =========================================
   SOCIAL
========================================= */


function detectSocial(
    html=""
){

    const text =
        html.toLowerCase();



    return {


        twitter:

            text.includes(
                "twitter.com"
            )
            ||
            text.includes(
                "x.com"
            ),



        discord:

            text.includes(
                "discord.gg"
            ),



        telegram:

            text.includes(
                "t.me"
            ),



        github:

            text.includes(
                "github.com"
            ),



        medium:

            text.includes(
                "medium.com"
            )

    };


}





/* =========================================
   DOCUMENTS
========================================= */


function detectDocuments(
    html=""
){

    const text =
        html.toLowerCase();



    return {


        whitepaper:

            text.includes(
                "whitepaper"
            )
            ||
            text.includes(
                "litepaper"
            ),



        docs:

            text.includes(
                "docs."
            )
            ||
            text.includes(
                "/docs"
            ),



        roadmap:

            text.includes(
                "roadmap"
            )

    };


}





/* =========================================
   SCORE
========================================= */


function calculateWebsiteScore(
    data={}
){

    let score = 0;



    if(data.ssl){

        score += 15;

    }



    const socialCount =

        Object.values(
            data.social || {}
        )
        .filter(Boolean)
        .length;



    if(socialCount >= 5){

        score += 25;

    }
    else if(socialCount >= 3){

        score += 15;

    }
    else if(socialCount >= 1){

        score += 5;

    }



    if(
        data.documents?.whitepaper
    ){

        score += 20;

    }



    if(
        data.documents?.docs
    ){

        score += 15;

    }



    if(
        data.documents?.roadmap
    ){

        score += 10;

    }



    if(data.online){

        score += 15;

    }



    return Math.min(
        score,
        100
    );

}





/* =========================================
   SCAN WEBSITE
========================================= */


async function scanWebsite(
    context={}
){

    const project =
        context.project || {};



    const url =

        project.website ||

        project.url ||

        project.site ||

        "";




    if(!url){


        return {


            website_score:0,


            community_score:0,


            html:"",


            text:""

        };


    }





    const response =
        await request(url);




    const html =
        response.text || "";



    const text =
        extractVisibleText(
            html
        );



    const social =
        detectSocial(
            html
        );



    const documents =
        detectDocuments(
            html
        );



    const meta =
        extractMeta(
            html
        );



    const ssl =
        checkSSL(
            url
        );



    const score =
        calculateWebsiteScore({

            ssl,

            online:
                response.ok,

            social,

            documents

        });





    return {


        website_url:

            url,



        online:

            response.ok,



        status:

            response.status,



        ssl,



        /*
        RAW HTML
        cho AI scanner
        */

        html,



        /*
        CLEAN TEXT
        cho team AI
        */

        text,



        meta,



        social,



        documents,



        website_score:

            score,



        community_score:

            score


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanWebsite,


    calculateWebsiteScore,


    detectSocial,


    detectDocuments,


    extractVisibleText

};