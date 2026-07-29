// =========================================
// services/scan/scan.audit.js
// =========================================

"use strict";


const auditCollector =
    require("../collectors/audit.collector");



/* =========================================
   HELPERS
========================================= */


function safeNumber(value){

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
-----------------------------------------
Detect audit information from project
-----------------------------------------
*/


function extractAuditInfo(
    project={}
){


    return {


        certik_project:

            project.certik_project ||

            project.certik_id ||

            "",



        audit_url:

            project.audit_url ||

            project.audit_report ||

            "",



        audit_provider:

            project.audit_provider ||

            "",



        audit_date:

            project.audit_date ||

            null


    };


}



/* =========================================
   SCAN AUDIT
========================================= */


async function scanAudit(
    context={}
){


    const project =
        context.project || {};



    const auditData =
        extractAuditInfo(
            project
        );



    /*
    =====================================
       NO AUDIT DATA
    =====================================
    */


    if(

        !auditData.certik_project &&

        !auditData.audit_url

    ){


        return {


            audited:false,


            provider:"",


            audit_score:0,


            security_score:0,


            findings:0,


            report_url:"",


            message:

                "Audit information missing"


        };


    }





    const result =
        await auditCollector.fetchAudit(
            auditData
        );



    if(!result){


        return {


            audited:false,


            audit_score:0,


            security_score:0


        };


    }





    return {


        /*
        ===============================
           AUDIT INFO
        ===============================
        */


        audited:

            !!result.audited,


        audit_provider:

            result.provider || "",


        audit_report_url:

            result.report_url || "",


        last_audit:

            result.last_audit || "",



        findings:

            safeNumber(
                result.findings
            ),




        /*
        ===============================
           SCORE
        ===============================
        */


        security_score:

            safeNumber(
                result.score
            ),


        audit_score:

            safeNumber(
                result.audit_score
            )


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanAudit,


    extractAuditInfo


};