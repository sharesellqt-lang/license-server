"use strict";

/* =========================================
   AUDIT COLLECTOR
========================================= */

const fetch =
    global.fetch ||
    require("node-fetch");

/*
---------------------------------------------
Supported Sources

Hacken
Certik
Cyberscope
SolidProof
Coinsult
SlowMist

The collector attempts to normalize all
audit providers into one common format.
---------------------------------------------
*/

const SOURCES = [

    "https://skynet.certik.com",

    "https://hacken.io",

    "https://www.cyberscope.io",

    "https://solidproof.io",

    "https://coinsult.net",

    "https://slowmist.com"

];

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

function normalizeProvider(name){

    if(!name){

        return "";

    }

    name =
        String(name)
        .toLowerCase();

    if(name.includes("certik")){

        return "Certik";

    }

    if(name.includes("hacken")){

        return "Hacken";

    }

    if(name.includes("cyberscope")){

        return "Cyberscope";

    }

    if(name.includes("solid")){

        return "SolidProof";

    }

    if(name.includes("coinsult")){

        return "Coinsult";

    }

    if(name.includes("slowmist")){

        return "SlowMist";

    }

    return name;

}

/* =========================================
   CERTIK
========================================= */

async function fetchCertik(project){

    if(
        !project
    ){

        return null;

    }

    try{

        const res =
            await fetch(

                `https://skynet.certik.com/api/v1/projects/${project}`

            );

        if(!res.ok){

            return null;

        }

        const json =
            await res.json();

        return {

            provider:
                "Certik",

            audited:
                true,

            score:
                number(
                    json.securityScore
                ),

            report_url:
                json.auditReport ||

                "",

            last_audit:
                json.updatedAt ||

                "",

            findings:

                number(
                    json.findings
                )

        };

    }

    catch(_){

        return null;

    }

}

/* =========================================
   GENERIC URL CHECK
========================================= */

async function checkAuditUrl(url){

    try{

        const res =
            await fetch(

                url,

                {

                    method:"HEAD"

                }

            );

        return res.ok;

    }

    catch(_){

        return false;

    }

}

/* =========================================
   MAIN
========================================= */

async function fetchAudit(data={}){

    /*
    Priority

    1 Certik Project

    2 Audit URL

    */

    if(
        data.certik_project
    ){

        const result =
            await fetchCertik(

                data.certik_project

            );

        if(result){

            return {

                ...result,

                audit_score:

                    calculateScore(

                        result

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

                    data.audit_provider ||

                    data.audit_url

                );

            const result = {

                provider,

                audited:true,

                report_url:

                    data.audit_url,

                findings:0,

                score:80,

                last_audit:

                    data.audit_date ||

                    ""

            };

            return {

                ...result,

                audit_score:

                    calculateScore(

                        result

                    )

            };

        }

    }

    return {

        provider:"",

        audited:false,

        score:0,

        findings:0,

        report_url:"",

        last_audit:"",

        audit_score:0

    };

}

/* =========================================
   SCORE
========================================= */

function calculateScore(audit={}){

    if(
        !audit.audited
    ){

        return 0;

    }

    let score = 0;

    score +=

        Math.min(

            60,

            number(
                audit.score
            )

        );

    if(

        audit.provider ===
        "Certik"

    ){

        score += 20;

    }

    else if(

        audit.provider ===
        "Hacken"

    ){

        score += 18;

    }

    else if(

        audit.provider ===
        "SlowMist"

    ){

        score += 18;

    }

    else if(

        audit.provider ===
        "Cyberscope"

    ){

        score += 15;

    }

    else{

        score += 10;

    }

    if(

        number(
            audit.findings
        ) === 0

    ){

        score += 20;

    }

    else if(

        number(
            audit.findings
        ) <= 5

    ){

        score += 10;

    }

    if(
        score > 100
    ){

        score = 100;

    }

    return score;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchAudit,

    fetchCertik,

    calculateScore,

    SOURCES

};