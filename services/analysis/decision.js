"use strict";


function calculate(data = {}) {


    const score =
        Number(
            data.overall_score || 0
        );


    const riskScore =
        Number(
            data.risk_score || 50
        );


    const risk =
        data.risk_level || "medium";


    let decision =
        "WATCH";


    if (
        score >= 80 &&
        (
            risk === "very-low" ||
            risk === "low"
        )
    ) {

        decision =
            "BUY";

    }

    else if (

        score < 40 ||

        risk === "very-high"

    ) {

        decision =
            "AVOID";

    }



    const confidence =
        Math.min(
            100,
            Math.max(
                0,
                Math.round(
                    score * 0.7 +
                    (100 - riskScore) * 0.3
                )
            )
        );



    return {

        decision,

        confidence

    };

}


module.exports = {

    calculate

};