// =========================================
// routes/airdrop.routes.js
// =========================================

"use strict";

const express =
    require("express");

const router =
    express.Router();

/* =========================================
   MIDDLEWARE
========================================= */

const authMiddleware =
    require("../middleware/auth");

const requirePlan =
    require("../middleware/requirePlan");

/* =========================================
   SERVICES
========================================= */

const scanService =
    require("../services/airdrop.scan.service");

const walletService =
    require("../services/airdrop.wallet.service");

/*
|--------------------------------------------------------------------------
| NOTE
|--------------------------------------------------------------------------
|
| CRUD Project sẽ được bổ sung ở
| airdrop.project.service.js
|
| router này đã chuẩn bị sẵn vị trí.
|
|--------------------------------------------------------------------------
*/

/* =========================================
   GET
   /api/airdrop/scan
========================================= */

router.get(
    "/scan",
    authMiddleware,
    async (req, res) => {

        try {

            const projects =
                await scanService.scan();

            return res.json({

                success: true,

                total:
                    projects.length,

                projects

            });

        }

        catch (err) {

            console.error(
                "[Airdrop Scan]",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Scan failed."

            });

        }

    }
);

/* =========================================
   POST
   /api/airdrop/wallet-check
========================================= */

router.post(
    "/wallet-check",

    authMiddleware,

    requirePlan("vip"),

    async (req, res) => {

        try {

            const wallets =

                Array.isArray(
                    req.body?.wallets
                )

                    ? req.body.wallets

                    : [];

            const result =

                await walletService.checkWallets(
                    wallets
                );

            return res.json({

                success: true,

                total:
                    result.length,

                summary:
                    walletService.summarize(
                        result
                    ),

                result

            });

        }

        catch (err) {

            console.error(
                "[Wallet Check]",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Wallet check failed."

            });

        }

    }
);

/* =========================================
   RESERVED
   CRUD PROJECT
========================================= */

/*

GET
/api/airdrop/projects

↓

airdrop.project.service.js

*/

/*

POST
/api/airdrop/projects

*/

/*

PUT
/api/airdrop/projects/:id

*/

/*

DELETE
/api/airdrop/projects/:id

*/

/* =========================================
   RESERVED
   EXPORT
========================================= */

/*

GET
/api/airdrop/export/json

*/

/*

GET
/api/airdrop/export/csv

*/

/* =========================================
   HEALTH
========================================= */

router.get(
    "/health",

    async (req, res) => {

        return res.json({

            success: true,

            service:
                "airdrop",

            status:
                "ok",

            timestamp:
                Date.now()

        });

    }
);

/* =========================================
   EXPORT
========================================= */

module.exports =
    router;

    