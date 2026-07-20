const strategyEngine =
    require("./airdrop.strategy.engine");

const learning =
    require("./airdrop.learning.engine");

const adaptive =
    require("./airdrop.adaptive.engine");

const performance =
    await learning.analyzePerformance(input.userId);

const weights =
    adaptive.adjustWeights(DEFAULT_WEIGHTS, performance);


function buildFeatures({ wallet, project, metrics }) {

    return {

        // Wallet exposure
        wallet_roi: wallet.roi || 0,
        wallet_risk: wallet.risk_score || 0,

        // Project fundamentals
        score: metrics.total_score || 0,
        risk: metrics.risk_level || "medium",

        fdv: metrics.fdv || 0,
        mc: metrics.market_cap || 0,

        upside:
            metrics.fair_buy_price && metrics.current_price
                ? metrics.fair_buy_price / metrics.current_price
                : 1,

        unlock_risk:
            metrics.circulating_supply && metrics.max_supply
                ? 1 - (metrics.circulating_supply / metrics.max_supply)
                : 0,

        near_ath:
            metrics.ath_price && metrics.current_price
                ? metrics.current_price / metrics.ath_price
                : 0
    };
}

function score(features) {

    let score = 50; // base neutral

    // Project quality
    score += (features.score / 100) * 40;

    score += (features.score / 100) * weights.fundamental_weight;

    // Risk penalty
    if (features.risk === "high") score -= 25;
    if (features.risk === "very-high") score -= 40;

    // Upside potential
    if (features.upside > 1.5) score += 20;
    if (features.upside > 2) score += 30;

    // Unlock risk penalty
    if (features.unlock_risk > 0.7) score -= 20;

    // Near ATH penalty (buying top)
    if (features.near_ath > 0.9) score -= 15;

    // Wallet alignment bonus
    if (features.wallet_roi > 1) score += 10;

    return Math.max(0, Math.min(100, score));
}

function decide(score, features) {

    if (score >= 80) {

        return {
            action: "ACCUMULATE",
            confidence: "high"
        };
    }

    if (score >= 65) {

        return {
            action: "BUY",
            confidence: "medium"
        };
    }

    if (score >= 50) {

        return {
            action: "HOLD",
            confidence: "low"
        };
    }

    if (score >= 30) {

        return {
            action: "WATCH",
            confidence: "low"
        };
    }

    return {
        action: "AVOID",
        confidence: "high"
    };
}

function analyzeDecision(input) {

    const features =
        buildFeatures(input);

    const scoreValue =
        score(features);

    const decision =
        decide(scoreValue, features);

    const strategy =
    strategyEngine.generateStrategy({
        decision,
        features,
        wallet: input.wallet
    });

    return {

        features,

        score: scoreValue,

        action: decision.action,

        confidence: decision.confidence,

        reasoning: generateReason(features, scoreValue),

        strategy   // 👈 NEW
    };
}

function generateReason(f, score) {

    const reasons = [];

    if (f.upside > 2)
        reasons.push("High upside potential");

    if (f.risk === "high")
        reasons.push("High risk profile");

    if (f.unlock_risk > 0.7)
        reasons.push("Heavy unlock pressure");

    if (f.score > 80)
        reasons.push("Strong fundamentals");

    return reasons;
}

