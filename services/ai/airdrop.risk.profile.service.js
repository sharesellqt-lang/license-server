// =========================================
// services/ai/airdrop.risk.profile.service.js
// =========================================

"use strict";


/*
|--------------------------------------------------------------------------
| USER RISK PROFILE ENGINE
|--------------------------------------------------------------------------
|
| Phân tích:
|
| - Wallet ROI
| - Portfolio exposure
| - Token concentration
| - Loss history
| - Win rate AI
|
|--------------------------------------------------------------------------
*/


/* =========================================
   CONFIG
========================================= */


const PROFILE_CONFIG = {

    LOW_RISK_THRESHOLD: 30,

    MEDIUM_RISK_THRESHOLD: 60,

    MAX_SINGLE_TOKEN_EXPOSURE: 40,

    HIGH_LOSS_RATE: 60

};


/* =========================================
   CLAMP
========================================= */


function clamp(value, min, max){

    value = Number(value || 0);

    return Math.min(
        Math.max(value,min),
        max
    );

}



/* =========================================
   CALCULATE RISK SCORE
========================================= */


function calculateRiskScore(data={}){


    let risk = 0;


    /*
    -----------------------------
    Portfolio concentration
    -----------------------------
    */


    const exposure =
        Number(
            data.max_token_exposure || 0
        );


    if(
        exposure >
        PROFILE_CONFIG.MAX_SINGLE_TOKEN_EXPOSURE
    ){

        risk += 25;

    }



    /*
    -----------------------------
    Loss history
    -----------------------------
    */


    const lossRate =
        Number(
            data.loss_rate || 0
        );


    if(
        lossRate >
        PROFILE_CONFIG.HIGH_LOSS_RATE
    ){

        risk += 30;

    }
    else {

        risk += lossRate * 0.2;

    }



    /*
    -----------------------------
    Wallet volatility
    -----------------------------
    */


    const roi =
        Number(
            data.wallet_roi || 0
        );


    if(roi < -30){

        risk += 25;

    }


    if(roi > 100){

        // user chịu được biến động cao

        risk -= 10;

    }



    /*
    -----------------------------
    Number of positions
    -----------------------------
    */


    const positions =
        Number(
            data.token_count || 0
        );


    if(
        positions <= 3
    ){

        risk += 15;

    }



    return clamp(
        risk,
        0,
        100
    );


}



/* =========================================
   PROFILE LABEL
========================================= */


function getProfile(score){


    if(
        score <=
        PROFILE_CONFIG.LOW_RISK_THRESHOLD
    ){

        return "CONSERVATIVE";

    }



    if(
        score <=
        PROFILE_CONFIG.MEDIUM_RISK_THRESHOLD
    ){

        return "BALANCED";

    }


    return "AGGRESSIVE";

}



/* =========================================
   ALLOCATION SUGGESTION
========================================= */


function getAllocation(profile){


    switch(profile){


        case "CONSERVATIVE":

            return {

                high_risk_projects: "10%",

                medium_risk_projects: "30%",

                low_risk_projects: "60%"

            };



        case "BALANCED":

            return {

                high_risk_projects: "25%",

                medium_risk_projects: "45%",

                low_risk_projects: "30%"

            };



        case "AGGRESSIVE":

            return {

                high_risk_projects: "50%",

                medium_risk_projects: "40%",

                low_risk_projects: "10%"

            };


    }


}



/* =========================================
   BUILD PROFILE
========================================= */


function buildRiskProfile(data={}){


    const riskScore =
        calculateRiskScore(data);


    const profile =
        getProfile(
            riskScore
        );


    return {


        risk_score:
            riskScore,


        profile,


        allocation:
            getAllocation(profile),


        max_position:

            profile === "CONSERVATIVE"
                ? 10
                :
            profile === "BALANCED"
                ? 20
                :
                40,


        description:


            profile === "CONSERVATIVE"

                ?
                "Prefers safety, low volatility"

                :

            profile === "BALANCED"

                ?
                "Accepts moderate volatility"

                :

                "Accepts high volatility for higher ROI"

    };


}



/* =========================================
   EXPORT
========================================= */


module.exports = {


    PROFILE_CONFIG,

    calculateRiskScore,

    getProfile,

    buildRiskProfile

};