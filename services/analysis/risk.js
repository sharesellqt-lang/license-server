"use strict";

function calculate(data = {}) {

    let score = 0;

    if (data.locked_percent > 80)
        score += 30;

    if (data.fdv > data.market_cap * 8)
        score += 25;

    if (data.current_price >= data.ath_price * 0.8)
        score += 15;

    let level = "low";

    if (score >= 60)
        level = "very-high";

    else if (score >= 40)
        level = "high";

    else if (score >= 20)
        level = "medium";

    return {

        risk_score:
            score,

        risk_level:
            level

    };

}

module.exports = {

    calculate

};