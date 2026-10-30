
"use strict";

const PLAN_LEVELS = Object.freeze({
    free: 0,
    pro: 1,
    vip: 2
});

module.exports = (requiredPlan = "free") => {
    const required = PLAN_LEVELS[String(requiredPlan).toLowerCase()];

    if (required === undefined) {
        throw new Error(`Invalid required plan: ${requiredPlan}`);
    }

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        const plan = String(req.user.plan || "free").toLowerCase();
        const current = PLAN_LEVELS[plan];

        if (current === undefined) {
            return res.status(403).json({
                success: false,
                error: "Invalid account plan"
            });
        }

        if (current < required) {
            return res.status(403).json({
                success: false,
                error: "Upgrade required",
                requiredPlan
            });
        }

        next();
    };
};
