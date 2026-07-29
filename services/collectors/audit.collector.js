"use strict";

/* =========================================
   AUDIT COLLECTOR
   services/collectors/audit.collector.js

   Sources:
   - Certik
   - Hacken
   - Cyberscope
   - SolidProof
   - Coinsult
   - SlowMist

   Output normalized:

   {
       audit_provider,
       audited,
       audit_score,
       security_score,
       findings,
       report_url,
       last_audit
   }

========================================= */


const fetch =
    global.fetch ||
    require("node-fetch");



const TIMEOUT = 10000;



const SOURCES = [

    "Certik",
    "Hacken",
    "Cyberscope",
    "SolidProof",
    "Coinsult",
    "SlowMist"

];



/* =========================================
   HELPERS
========================================= */


function number(value){

    value = Number(value);


    if(
        !Number.isFinite(value)
    ){

        return 0;

    }


    return value;

}



function clamp(
    value,
    min,
    max
){

    return Math.min(
        Math.max(
            number(value),
            min
        ),
        max
    );

}




function normalizeProvider(
    name=""
){

    name =
        String(name)
        .toLowerCase();



    if(name.includes("certik"))
        return "Certik";


    if(name.includes("hacken"))
        return "Hacken";


    if(name.includes("cyberscope"))
        return "Cyberscope";


    if(
        name.includes("solid")
    )
        return "SolidProof";


    if(
        name.includes("coinsult")
    )
        return "Coinsult";


    if(
        name.includes("slow")
    )
        return "SlowMist";



    return "";

}



/* =========================================
   SAFE FETCH
========================================= */


async function request(
    url,
    options={}
){

    try{


        const controller =
            new AbortController();



        const timer =
            setTimeout(
                ()=>controller.abort(),
                TIMEOUT
            );



        const res =
            await fetch(
                url,
                {
                    ...options,
                    signal:
                        controller.signal
                }
            );



        clearTimeout(timer);



        if(
            !res.ok
        ){

            return null;

        }



        return res;


    }
    catch(err){

        return null;

    }

}



/* =========================================
   CERTIK
========================================= */


async function fetchCertik(
    projectId
){

    if(
        !projectId
    ){

        return null;

    }



    const url =
        `https://skynet.certik.com/api/v1/projects/${projectId}`;



    const res =
        await request(url);



    if(!res){

        return null;

    }



    try{


        const json =
            await res.json();



        return {

            audit_provider:
                "Certik",


            audited:
                true,


            security_score:

                clamp(
                    json.securityScore,
                    0,
                    100
                ),



            findings:

                number(
                    json.findings
                ),



            report_url:

                json.auditReport
                ||
                "",



            last_audit:

                json.updatedAt
                ||
                ""

        };


    }
    catch(_){

        return null;

    }

}



/* =========================================
   AUDIT URL CHECK
========================================= */


async function checkAuditUrl(
    url
){

    if(!url){

        return false;

    }



    /*
       Try HEAD first
    */


    let res =
        await request(
            url,
            {
                method:"HEAD"
            }
        );



    if(res){

        return true;

    }



    /*
       Some audit pages block HEAD
       fallback GET
    */


    res =
        await request(
            url,
            {
                method:"GET"
            }
        );



    return !!res;

}



/* =========================================
   PROVIDER SCORE
========================================= */


function providerScore(
    provider
){

    const scores = {


        Certik:
            20,


        Hacken:
            18,


        SlowMist:
            18,


        Cyberscope:
            15,


        SolidProof:
            15,


        Coinsult:
            12

    };



    return scores[provider] || 10;

}



/* =========================================
   CALCULATE SCORE
========================================= */


function calculateScore(
    audit={}
){


    if(
        !audit.audited
    ){

        return 0;

    }



    let score = 0;



    /*
       Security score
    */


    score +=

        clamp(
            audit.security_score,
            0,
            60
        );



    /*
       Provider reputation
    */


    score +=

        providerScore(
            audit.audit_provider
        );



    /*
       Findings
    */


    const findings =
        number(
            audit.findings
        );



    if(
        findings === 0
    ){

        score += 20;

    }

    else if(
        findings <=5
    ){

        score +=10;

    }



    return clamp(
        Math.round(score),
        0,
        100
    );

}



/* =========================================
   MAIN COLLECTOR
========================================= */


async function fetchAudit(
    data={}
){


    /*
       Priority:

       1. Certik project
       2. Manual audit URL

    */



    if(
        data.certik_project
    ){

        const certik =
            await fetchCertik(
                data.certik_project
            );



        if(certik){


            return {

                ...certik,

                audit_score:

                    calculateScore(
                        certik
                    )

            };

        }

    }





    if(
        data.audit_url
    ){


        const exists =
            await checkAuditUrl(
                data.audit_url
            );



        if(exists){


            const provider =
                normalizeProvider(

                    data.audit_provider
                    ||
                    data.audit_url

                );



            const audit = {


                audit_provider:

                    provider,


                audited:

                    true,


                security_score:

                    80,


                findings:

                    0,


                report_url:

                    data.audit_url,


                last_audit:

                    data.audit_date
                    ||
                    ""

            };



            return {


                ...audit,


                audit_score:

                    calculateScore(
                        audit
                    )

            };


        }

    }





    return {

        audit_provider:"",

        audited:false,

        security_score:0,

        findings:0,

        report_url:"",

        last_audit:"",

        audit_score:0

    };

}



/* =========================================
   EXPORT
========================================= */


module.exports = {


    SOURCES,


    fetchAudit,


    fetchCertik,


    calculateScore,


    normalizeProvider


};