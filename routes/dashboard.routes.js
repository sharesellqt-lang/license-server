// =========================================
// routes/dashboard.routes.js
// =========================================

"use strict";

const express = require("express");

const router = express.Router();

const auth =
    require("../middleware/auth");

const dashboardService =
    require("../services/dashboard.service");

/* =========================================
   GET DASHBOARD
========================================= */

router.get(
    "/dashboard",
    auth,
    async (req, res) => {

        try {

            const dashboard =
                await dashboardService.loadDashboard(
                    req.user.id
                );

            res.json({

                success: true,

                user: {

                    id: req.user.id,

                    email: req.user.email,

                    plan: req.user.plan,

                    isAdmin: req.user.isAdmin

                },

                dashboard

            });

        }
        catch (err) {

            console.error(
                "Dashboard Error:",
                err
            );

            res.status(500).json({

                success: false,

                message:
                    "Cannot load dashboard"

            });

        }

    }
);

module.exports = router;