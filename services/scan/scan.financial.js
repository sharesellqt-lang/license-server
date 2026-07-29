"use strict";

/*
=========================================
 services/scan/scan.financial.js
=========================================

Financial Intelligence Scanner

Sources:

- DefiLlama
- TokenTerminal
- Existing metrics

Output:

{
 protocol_fee,
 protocol_revenue,
 revenue_growth_30d,
 treasury,
 cash_runway_months,
 stablecoin_reserve,
 financial_score
}

=========================================
*/


/* ========================================
   HELPERS
======================================== */


function number(value){

    value = Number(value);


    if(
        !Number.isFinite(value)
    ){

        return 0;

    }


    return value;

}



/*
=========================================
 SCORE ENGINE
=========================================
*/


function calculateFinancialScore(
    data = {}
){


    let score = 0;



    /*
    ===============================
       REVENUE
    ===============================
    */


    const revenue =
        number(
            data.protocol_revenue
        );


    if(
        revenue >= 10000000
    ){

        score += 25;

    }

    else if(
        revenue >= 1000000
    ){

        score += 18;

    }

    else if(
        revenue >= 100000
    ){

        score += 10;

    }




    /*
    ===============================
       FEES
    ===============================
    */


    const fees =
        number(
            data.protocol_fee
        );


    if(
        fees >= 5000000
    ){

        score += 20;

    }

    else if(
        fees >= 500000
    ){

        score += 12;

    }

    else if(
        fees > 0
    ){

        score += 5;

    }





    /*
    ===============================
       TREASURY
    ===============================
    */


    const treasury =
        number(
            data.treasury
        );


    if(
        treasury >= 100000000
    ){

        score += 20;

    }

    else if(
        treasury >= 10000000
    ){

        score += 12;

    }

    else if(
        treasury >= 1000000
    ){

        score += 5;

    }





    /*
    ===============================
       RUNWAY
    ===============================
    */


    const runway =
        number(
            data.cash_runway_months
        );


    if(
        runway >= 24
    ){

        score += 15;

    }

    else if(
        runway >= 12
    ){

        score += 10;

    }

    else if(
        runway >= 6
    ){

        score += 5;

    }





    /*
    ===============================
       GROWTH
    ===============================
    */


    const growth =
        number(
            data.revenue_growth_30d
        );


    if(
        growth >= 20
    ){

        score += 20;

    }

    else if(
        growth >= 10
    ){

        score += 12;

    }

    else if(
        growth > 0
    ){

        score += 5;

    }




    return Math.min(
        score,
        100
    );

}





/*
=========================================
 FINANCIAL RATING
=========================================
*/


function rating(score){


    if(score >= 80){

        return "excellent";

    }


    if(score >= 60){

        return "good";

    }


    if(score >= 40){

        return "average";

    }


    if(score >= 20){

        return "weak";

    }


    return "poor";


}





/*
=========================================
 MAIN SCANNER
=========================================
*/


async function scanFinancial(
    context = {}
){


    const project =
        context.project || {};



    const metrics =
        context.metrics || {};



    const defi =
        context.defillama
        ||
        metrics.defillama
        ||
        {};



    const terminal =
        context.tokenterminal
        ||
        metrics.tokenterminal
        ||
        {};





    /*
    =====================================
       MERGE DATA
    =====================================
    */


    const financial = {


        protocol_fee:

            number(

                defi.protocol_fee

                ||

                terminal.protocol_fee

            ),



        protocol_revenue:

            number(

                defi.protocol_revenue

                ||

                terminal.revenue

                ||

                terminal.protocol_revenue

            ),



        revenue_growth_30d:

            number(

                defi.revenue_growth_30d

                ||

                terminal.revenue_growth

            ),



        treasury:

            number(

                defi.treasury

                ||

                terminal.treasury

            ),



        cash_runway_months:

            number(

                defi.cash_runway

                ||

                terminal.cash_runway

            ),



        stablecoin_reserve:

            number(

                defi.stablecoin_reserve

                ||

                terminal.stablecoin_reserve

            )



    };





    /*
    =====================================
       SCORE
    =====================================
    */


    const financial_score =

        calculateFinancialScore(
            financial
        );





    return {


        project_id:

            project.id,



        ...financial,



        financial_score,



        financial_rating:

            rating(
                financial_score
            )



    };


}





module.exports = {


    scanFinancial,


    calculateFinancialScore,


    rating


};