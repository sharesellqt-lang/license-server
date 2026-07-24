// =========================================
// services/analysis/recommendation.js
// =========================================

"use strict";


/* =========================================
   GENERATE
========================================= */

function generate(data = {}) {


    const reasons = [];

    const warnings = [];


    const score =
        Number(data.overall_score || 0);


    const risk =
        data.risk_level || "medium";


    const riskScore =
        Number(data.risk_score || 50);


    const current =
        Number(data.current_price || 0);


    const fairBuy =
        Number(data.fair_buy_price || 0);



    /* =====================================
       REASONS
    ===================================== */


    if (

        risk === "very-low" ||
        risk === "low"

    ) {

        reasons.push(
            "Low investment risk"
        );

    }


    if (

        fairBuy > 0 &&
        current <= fairBuy

    ) {

        reasons.push(
            "Trading below fair value"
        );

    }



    const fdv =
        Number(data.fdv || 0);


    const marketCap =
        Number(data.market_cap || 0);



    if (

        fdv > 0 &&
        marketCap > 0 &&
        fdv / marketCap <= 2

    ) {

        reasons.push(
            "Healthy FDV ratio"
        );

    }



    const circulating =
        Number(
            data.circulating_percent || 0
        );


    if (

        circulating >= 50

    ) {

        reasons.push(
            "Healthy circulating supply"
        );

    }



    if (

        Number(data.volume_24h || 0) > 0

    ) {

        reasons.push(
            "Active trading volume"
        );

    }



    if (

        Number(data.liquidity || 0)
        >= 1000000

    ) {

        reasons.push(
            "Strong liquidity"
        );

    }



    /* =====================================
       WARNINGS
    ===================================== */


    if (

        Number(data.locked_percent || 0)
        >= 80

    ) {

        warnings.push(
            "Large locked token supply"
        );

    }



    if (

        fdv > 0 &&
        marketCap > 0 &&
        fdv / marketCap > 8

    ) {

        warnings.push(
            "Very high FDV compared to Market Cap"
        );

    }



    if (

        Number(data.ath_price || 0) > 0 &&
        current >= Number(data.ath_price) * 0.8

    ) {

        warnings.push(
            "Price is close to ATH"
        );

    }



    /* =====================================
       RECOMMENDATION
    ===================================== */


    let recommendation =
        "Watch";


    let action =
        "Monitor";


    let badge =
        "yellow";



    /*
    =====================================
    EXCELLENT
    =====================================
    */


    if (

        score >= 80 &&
        riskScore <= 30

    ) {


        recommendation =
            "Strong Candidate";


        action =
            "Strong Buy";


        badge =
            "green";


    }


    /*
    =====================================
    GOOD
    =====================================
    */


    else if (

        score >= 60 &&
        riskScore <= 50

    ) {


        recommendation =
            "Worth Watching";


        action =
            "Consider";


        badge =
            "green";


    }


    /*
    =====================================
    SAFE BUT LOW SCORE
    =====================================
    */


    else if (

        riskScore <= 30 &&
        score < 60

    ) {


        recommendation =
            "Safe but Undervalued";


        action =
            "Research";


        badge =
            "blue";


    }


    /*
    =====================================
    MEDIUM RISK
    =====================================
    */


    else if (

        riskScore <= 70

    ) {


        recommendation =
            "Speculative";


        action =
            "Watch";


        badge =
            "orange";


    }


    /*
    =====================================
    HIGH RISK
    =====================================
    */


    else {


        recommendation =
            "Avoid";


        action =
            "Avoid";


        badge =
            "red";

    }



    return {


        recommendation,

        action,

        badge,

        reasons,

        warnings


    };


}



/* =========================================
   EXPORTS
========================================= */

module.exports = {

    generate

};