"use strict";


function calculate(data = {}) {


    const score =
        Number(
            data.total_score || 0
        );


    const risk =
        Number(
            data.risk_score || 0
        );


    const financial =
        Number(
            data.financial_score || 0
        );


    const tokenomics =
        Number(
            data.tokenomics_score || 0
        );


    const investment_score =

        (
            score * 0.5
        )
        +
        (
            risk * 0.2
        )
        +
        (
            financial * 0.15
        )
        +
        (
            tokenomics * 0.15
        );


    let rating =
        "AVOID";


    let action =
        "Avoid";


    if(
        investment_score >= 80
    ){

        rating =
            "STRONG BUY";

        action =
            "Consider Entry";

    }

    else if(
        investment_score >=65
    ){

        rating =
            "BUY";

        action =
            "Good Candidate";

    }

    else if(
        investment_score >=50
    ){

        rating =
            "WATCH";

        action =
            "Monitor";

    }

    else if(
        investment_score >=35
    ){

        rating =
            "SPECULATIVE";

        action =
            "High Risk";

    }


    return {

        investment_score:
            Number(
                investment_score.toFixed(2)
            ),

        investment_rating:
            rating,

        investment_action:
            action

    };


}


module.exports = {

    calculate

};