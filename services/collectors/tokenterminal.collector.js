"use strict";

/* =========================================
   TOKEN TERMINAL COLLECTOR
========================================= */

const fetch =
    global.fetch ||
    require("node-fetch");

const API =
    "https://api.tokenterminal.com/v2";

/* =========================================
   HELPERS
========================================= */

function number(value) {

    value = Number(value);

    if (!Number.isFinite(value)) {

        return 0;

    }

    return value;

}

function headers() {

    return {

        Accept:
            "application/json",

        Authorization:
            `Bearer ${process.env.TOKEN_TERMINAL_API_KEY || ""}`

    };

}

async function request(path) {

    const res =
        await fetch(

            API + path,

            {

                headers:
                    headers()

            }

        );

    if (!res.ok) {

        throw new Error(

            `TokenTerminal ${res.status}`

        );

    }

    return await res.json();

}

/* =========================================
   SAFE
========================================= */

function value(obj, ...keys) {

    for (const k of keys) {

        if (

            obj?.[k] !== undefined &&

            obj?.[k] !== null

        ) {

            return obj[k];

        }

    }

    return 0;

}

/* =========================================
   MAIN
========================================= */

async function fetchProject(projectId) {

    if (!projectId) {

        return null;

    }

    const json =
        await request(

            `/projects/${projectId}`

        );

    const d =
        json.data || {};

    const metrics =
        d.metrics || {};

    const treasury =
        number(

            value(

                metrics,

                "treasury",

                "treasury_usd",

                "treasury_value"

            )

        );

    const revenue =
        number(

            value(

                metrics,

                "revenue",

                "annualized_revenue",

                "revenue_usd"

            )

        );

    const protocolFee =
        number(

            value(

                metrics,

                "protocol_fees",

                "fees",

                "protocol_fee"

            )

        );

    const buyback =
        number(

            value(

                metrics,

                "buyback",

                "buybacks"

            )

        );

    const burn =
        number(

            value(

                metrics,

                "burn",

                "burned"

            )

        );

    const reserve =
        number(

            value(

                metrics,

                "stablecoin_reserve",

                "stablecoin_reserves"

            )

        );

    const runway =
        calculateRunway(

            treasury,

            revenue

        );

    const growth =
        number(

            value(

                metrics,

                "revenue_growth",

                "revenue_growth_30d",

                "growth"

            )

        );

    return {

        treasury,

        revenue,

        protocol_fee:

            protocolFee,

        revenue_growth:

            growth,

        cash_runway:

            runway,

        token_buyback:

            buyback,

        token_burn:

            burn,

        stablecoin_reserve:

            reserve,

        ps_ratio:

            number(

                value(

                    metrics,

                    "ps_ratio"

                )

            ),

        pe_ratio:

            number(

                value(

                    metrics,

                    "pe_ratio"

                )

            ),

        earnings:

            number(

                value(

                    metrics,

                    "earnings"

                )

            ),

        token_terminal_score:

            calculateScore({

                treasury,

                revenue,

                protocolFee,

                runway,

                reserve,

                growth,

                buyback,

                burn

            })

    };

}

/* =========================================
   CASH RUNWAY
========================================= */

function calculateRunway(

    treasury,

    yearlyRevenue

) {

    treasury =
        number(
            treasury
        );

    yearlyRevenue =
        number(
            yearlyRevenue
        );

    if (

        treasury <= 0 ||

        yearlyRevenue <= 0

    ) {

        return 0;

    }

    const monthlyCost =
        yearlyRevenue / 12;

    if (

        monthlyCost <= 0

    ) {

        return 0;

    }

    return Number(

        (

            treasury /

            monthlyCost

        ).toFixed(2)

    );

}

/* =========================================
   SCORE
========================================= */

function calculateScore(data = {}) {

    let score = 0;

    if (

        data.treasury >=

        100000000

    ) {

        score += 20;

    }

    else if (

        data.treasury >=

        10000000

    ) {

        score += 12;

    }

    if (

        data.revenue >=

        10000000

    ) {

        score += 20;

    }

    else if (

        data.revenue >=

        1000000

    ) {

        score += 10;

    }

    if (

        data.protocolFee >=

        5000000

    ) {

        score += 15;

    }

    else if (

        data.protocolFee >=

        500000

    ) {

        score += 8;

    }

    if (

        data.cash_runway >=

        24

    ) {

        score += 15;

    }

    else if (

        data.cash_runway >=

        12

    ) {

        score += 8;

    }

    if (

        data.revenue_growth >=

        20

    ) {

        score += 10;

    }

    else if (

        data.revenue_growth >=

        10

    ) {

        score += 5;

    }

    if (

        data.stablecoin_reserve >=

        10000000

    ) {

        score += 10;

    }

    if (

        data.token_buyback >

        0

    ) {

        score += 5;

    }

    if (

        data.token_burn >

        0

    ) {

        score += 5;

    }

    if (

        score > 100

    ) {

        score = 100;

    }

    return score;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchProject,

    calculateRunway,

    calculateScore

};