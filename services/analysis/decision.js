"use strict";


function calculate(data = {}) {


    const score =
        Number(
            data.investment_score || 0
        );


    const risk =
        data.risk_level || "medium";


    let decision = "WATCH";


    if (
        score >= 80 &&
        (
            risk === "very-low" ||
            risk === "low"
        )
    ) {

        decision = "BUY";

    }

    else if (
        score < 40 ||
        risk === "very-high"
    ) {

        decision = "AVOID";

    }


    return {

        decision,

        confidence:
            score,

    };

}


module.exports = {

    calculate

};