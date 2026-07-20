function adjustWeights(
    baseWeights = {},
    performance = {}
) {

    const adjusted = {

    risk_penalty: 1,

    upside_weight: 1,

    allocation_cap: 20,

    ...baseWeights

};

    const winRate =
        Number(performance.win_rate || 0);

    const lossRate =
        Number(performance.loss_rate || 0);

    if (winRate > 65) {

        adjusted.risk_penalty *= 0.8;
        adjusted.upside_weight *= 1.2;

    }

    if (winRate < 40) {

        adjusted.risk_penalty *= 1.3;
        adjusted.upside_weight *= 0.8;

    }

    if (lossRate > 60) {

        adjusted.allocation_cap = 10;

    }

    return adjusted;

}

module.exports = {
    adjustWeights
};