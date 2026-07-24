"use strict";

/* =========================================
   TOKENOMICS CALCULATOR
========================================= */

function calculate(m = {}) {

    let total =
        Number(m.total_supply || 0);

    let circulating =
        Number(m.circulating_supply || 0);

    let max =
        Number(m.max_supply || 0);

    const marketCap =
        Number(m.market_cap || 0);

    const fdv =
        Number(m.fdv || 0);

    let circulatingPercent = 0;

    let lockedPercent = 0;

    let inflation = 0;

    /*
    =====================================
    FALLBACK
    only total supply exists
    =====================================
    */

    if (

        total > 0 &&
        circulating <= 0

    ) {

        circulating = total;

    }

    if (

        total > 0 &&
        max <= 0

    ) {

        max = total;

    }

    /*
    =====================================
    CASE 1
    Supply available
    =====================================
    */

    if (

        total > 0 &&
        circulating > 0

    ) {

        circulatingPercent =
            circulating /
            total *
            100;

        if (

            circulatingPercent > 100

        ) {

            circulatingPercent = 100;

        }

        lockedPercent =
            100 -
            circulatingPercent;

        if (

            lockedPercent < 0

        ) {

            lockedPercent = 0;

        }

        if (

            max > 0

        ) {

            inflation =
                (
                    max -
                    circulating
                )
                /
                max
                *
                100;

            if (

                inflation < 0

            ) {

                inflation = 0;

            }

        }

    }

    /*
    =====================================
    CASE 2
    No supply
    Use MarketCap / FDV
    =====================================
    */

    else if (

        marketCap > 0 &&
        fdv > 0

    ) {

        circulatingPercent =
            marketCap /
            fdv *
            100;

        if (

            circulatingPercent > 100

        ) {

            circulatingPercent = 100;

        }

        if (

            circulatingPercent < 0

        ) {

            circulatingPercent = 0;

        }

        lockedPercent =
            100 -
            circulatingPercent;

        if (

            lockedPercent < 0

        ) {

            lockedPercent = 0;

        }

        inflation =
            lockedPercent;

    }

    return {

        circulating_percent:
            Number(
                circulatingPercent.toFixed(2)
            ),

        locked_percent:
            Number(
                lockedPercent.toFixed(2)
            ),

        inflation:
            Number(
                inflation.toFixed(2)
            )

    };

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    calculate

};