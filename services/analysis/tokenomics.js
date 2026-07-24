"use strict";

function calculate(m = {}) {

    const total =
        Number(m.total_supply || 0);

    const circulating =
        Number(m.circulating_supply || 0);

    const max =
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
    CASE 1
    Có supply
    =====================================
    */

    if (
        total > 0 &&
        circulating > 0
    ) {

        circulatingPercent =
            circulating / total * 100;

        lockedPercent =
            100 - circulatingPercent;

        if (max > 0) {

            inflation =
                (max - circulating)
                / max
                * 100;

        }

    }

    /*
    =====================================
    CASE 2
    Không có supply
    nhưng có MarketCap + FDV
    =====================================
    */

    else if (

        marketCap > 0 &&
        fdv > 0

    ) {

        circulatingPercent =
            marketCap / fdv * 100;

        if (
            circulatingPercent > 100
        ) {
            circulatingPercent = 100;
        }

        lockedPercent =
            100 - circulatingPercent;

        inflation =
            lockedPercent;

    }

    return {

        circulating_percent:
            circulatingPercent,

        locked_percent:
            lockedPercent,

        inflation:
            inflation

    };

}

module.exports = {

    calculate

};