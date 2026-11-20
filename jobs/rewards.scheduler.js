
"use strict";

const referralPayoutService = require("../services/rewards.referral.payout.service");

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_LIMIT = 50;

let isRunning = false;

async function runRewardsScheduler() {
    if (isRunning) {
        console.log("[REWARDS SCHEDULER] Previous run is still running. Skipped.");
        return;
    }

    isRunning = true;

    try {
        const result = await referralPayoutService.processDueAttributions({
            limit: BATCH_LIMIT
        });

        console.log("[REWARDS SCHEDULER] Completed:", {
            attempted: result.attempted,
            rewarded: result.rewarded,
            failed: result.failed
        });

        if (result.errors?.length) {
            console.error("[REWARDS SCHEDULER] Errors:", result.errors);
        }

    } catch (err) {
        console.error("[REWARDS SCHEDULER] ERROR:", err);
    } finally {
        isRunning = false;
    }
}

// Run once when the server starts
runRewardsScheduler();

// Then run every 5 minutes
const scheduler = setInterval(runRewardsScheduler, INTERVAL_MS);

scheduler.unref?.();

console.log("[REWARDS SCHEDULER] Started. Interval: 5 minutes.");

module.exports = {
    runRewardsScheduler
};
