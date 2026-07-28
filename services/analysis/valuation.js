"use strict";

function calculate(m = {}) {

    const currentPrice =
        Number(m.current_price || 0);

    const circulating =
        Number(m.circulating_supply || 0);

    const maxSupply =
        Number(m.max_supply || 0);

    const marketCap =
        Number(
            m.market_cap ||
            currentPrice * circulating
        );


    const fdv =
        Number(
            m.fdv ||
            currentPrice * maxSupply
        );

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