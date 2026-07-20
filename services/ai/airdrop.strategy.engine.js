function generateStrategy({ decision, features, wallet }) {

    const strategy = {

        action: decision.action,

        confidence: decision.confidence,

        entry_zone: null,

        dca: [],
        take_profit: [],
        stop_loss: null,

        allocation: 0
    };

    const current = features.current_price || 0;

    if (decision.action === "ACCUMULATE" ||
        decision.action === "BUY") {

        strategy.entry_zone = {
            low: current * 0.9,
            high: current * 1.05
        };
    }

    if (decision.action === "ACCUMULATE") {

        strategy.dca = [

            { level: 1, percent: 30 },
            { level: 2, percent: 30, price: current * 0.95 },
            { level: 3, percent: 40, price: current * 0.85 }

        ];
    }

    const upside =
        features.upside || 1;

    strategy.take_profit = [

        {
            level: 1,
            price: current * 1.3,
            percent: 30
        },

        {
            level: 2,
            price: current * 1.8,
            percent: 30
        },

        {
            level: 3,
            price: current * 2.5,
            percent: 40
        }
    ];

    if (features.risk === "high") {

        strategy.stop_loss =
            current * 0.75;

    } else {

        strategy.stop_loss =
            current * 0.85;
    }

    const base = 10;

    if (features.score > 80) {
        strategy.allocation = base * 3; // 30%
    }
    else if (features.score > 65) {
        strategy.allocation = base * 2; // 20%
    }
    else {
        strategy.allocation = base; // 10%
    }

    return strategy;
}

module.exports = {
    generateStrategy
};

