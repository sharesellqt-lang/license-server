
"use strict";

const deliveryService = require("../services/marketplace.delivery.service");

const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 50;

let isRunning = false;

async function runMarketplaceDeliveryScheduler() {
    if (isRunning) {
        console.log(
            "[MARKETPLACE DELIVERY SCHEDULER] Previous run is still running. Skipped."
        );
        return;
    }

    isRunning = true;

    try {
        const deliveryIds = await deliveryService.getDueDeliveryIds(
            BATCH_LIMIT
        );

        let confirmed = 0;
        let skipped = 0;
        let failed = 0;

        for (const deliveryId of deliveryIds) {
            try {
                await deliveryService.confirmDelivery(
                    deliveryId,
                    null,
                    "automatic"
                );

                confirmed++;
            } catch (err) {
                if (
                    err.code === "ACTIVE_SUPPORT_TICKET" ||
                    err.code === "AUTO_CONFIRM_NOT_DUE" ||
                    err.code === "DELIVERY_NOT_CONFIRMABLE" ||
                    err.code === "ORDER_NOT_PAID" ||
                    err.code === "ORDER_NOT_DELIVERABLE"
                ) {
                    skipped++;
                    continue;
                }

                failed++;

                console.error(
                    "[MARKETPLACE DELIVERY SCHEDULER] Delivery error:",
                    {
                        deliveryId,
                        code: err.code || null,
                        message: err.message
                    }
                );
            }
        }

        console.log("[MARKETPLACE DELIVERY SCHEDULER] Completed:", {
            attempted: deliveryIds.length,
            confirmed,
            skipped,
            failed
        });

    } catch (err) {
        console.error(
            "[MARKETPLACE DELIVERY SCHEDULER] ERROR:",
            err
        );
    } finally {
        isRunning = false;
    }
}

// Run once when server starts.
runMarketplaceDeliveryScheduler();

// Then run every 5 minutes.
const scheduler = setInterval(
    runMarketplaceDeliveryScheduler,
    INTERVAL_MS
);

scheduler.unref?.();

console.log(
    "[MARKETPLACE DELIVERY SCHEDULER] Started. Interval: 5 minutes."
);

module.exports = {
    runMarketplaceDeliveryScheduler
};
