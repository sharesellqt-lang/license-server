"use strict";

/* =========================================
   RISK CALCULATOR
========================================= */

function calculate(m = {}) {

    const marketCap =
        Number(m.market_cap || 0);

    const fdv =
        Number(m.fdv || 0);

    const liquidity =
        Number(m.liquidity || 0);

    const volume24h =
        Number(m.volume_24h || 0);

    const lockedPercent =
        Number(m.locked_percent || 0);

    const inflation =
        Number(m.inflation || 0);

    let risk = 0;

    /* =====================================
       MARKET CAP
    ===================================== */

    if (marketCap <= 0) {

        risk += 30;

    } else if (marketCap < 1000000) {

        risk += 25;

    } else if (marketCap < 10000000) {

        risk += 20;

    } else if (marketCap < 100000000) {

        risk += 10;

    }

    /* =====================================
       FDV vs MARKET CAP
    ===================================== */

    if (
        marketCap > 0 &&
        fdv > 0
    ) {

        const ratio =
            fdv / marketCap;

        if (ratio >= 10) {

            risk += 20;

        } else if (ratio >= 5) {

            risk += 15;

        } else if (ratio >= 2) {

            risk += 8;

        }

    }

    /* =====================================
       LIQUIDITY
    ===================================== */

    if (liquidity <= 0) {

        risk += 20;

    } else if (liquidity < 50000) {

        risk += 15;

    } else if (liquidity < 250000) {

        risk += 8;

    }

    /* =====================================
       VOLUME
    ===================================== */

    if (volume24h <= 0) {

        risk += 20;

    } else if (volume24h < 10000) {

        risk += 15;

    } else if (volume24h < 100000) {

        risk += 8;

    }

    /* =====================================
   PRICE VOLATILITY (24H)
===================================== */

const priceChange =
    Math.abs(
        Number(
            m.price_change_24h || 0
        )
    );

if (priceChange > 50) {

    risk += 15;

}
else if (priceChange > 20) {

    risk += 8;

}

    /* =====================================
       LOCKED TOKENS
    ===================================== */

    if (lockedPercent > 80) {

        risk += 20;

    } else if (lockedPercent > 60) {

        risk += 15;

    } else if (lockedPercent > 40) {

        risk += 8;

    }

    /* =====================================
       INFLATION
    ===================================== */

    if (inflation > 80) {

        risk += 20;

    } else if (inflation > 50) {

        risk += 15;

    } else if (inflation > 20) {

        risk += 8;

    }

    /* =====================================
       LIMIT
    ===================================== */

    if (risk > 100) {

        risk = 100;

    }

    let level = "very-low";

    if (risk >= 80) {

        level = "very-high";

    } else if (risk >= 60) {

        level = "high";

    } else if (risk >= 40) {

        level = "medium";

    } else if (risk >= 20) {

        level = "low";

    }

    return {

        risk_score: risk,

        risk_level: level

    };

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    calculate

};