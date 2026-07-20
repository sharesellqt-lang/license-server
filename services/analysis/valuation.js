"use strict";

function calculate(m = {}) {

    const currentPrice =
        Number(m.current_price || 0);

    const circulating =
        Number(m.circulating_supply || 0);

    const maxSupply =
        Number(m.max_supply || 0);

    const marketCap =
        currentPrice *
        circulating;

    const fdv =
        currentPrice *
        maxSupply;

    return {

        market_cap:
            marketCap,

        fdv:
            fdv

    };

}

module.exports = {

    calculate

};