"use strict";

function calculate(m = {}) {

    const total =
        Number(m.total_supply || 0);

    const circulating =
        Number(m.circulating_supply || 0);

    const max =
        Number(m.max_supply || 0);

    const circulatingPercent =
        total
            ? circulating / total * 100
            : 0;

    const remainingPercent =
        total
            ? 100 - circulatingPercent
            : 0;

    return {

        circulating_percent:
            circulatingPercent,

        locked_percent:
            remainingPercent,

        inflation:

            max > 0

                ? (max - circulating) / max * 100

                : 0

    };

}

module.exports = {

    calculate

};