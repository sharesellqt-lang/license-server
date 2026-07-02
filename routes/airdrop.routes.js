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

const projectService =
    require("../services/airdrop.project.service");


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

router.get("/export/json", authMiddleware, async (req, res) => {
    const data =
        await projectService.exportJson(req.user.id);

    res.setHeader("Content-Type", "application/json");
    res.send(data);
});

router.get("/export/csv", authMiddleware, async (req, res) => {
    const data =
        await projectService.exportCsv(req.user.id);

    res.setHeader("Content-Type", "text/csv");
    res.send(data);
});

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
   Get
   /api/airdrop/projects
========================================= */
router.get("/projects", authMiddleware, async (req, res) => {
    try {

        const projects =
            await projectService.getProjectsByUser(req.user.id);

        const result = await projectService.getProjectsByUser(req.user.id);

        return res.json(result);

    } catch (err) {

        console.error("[Projects GET]", err);

        return res.status(500).json({
            success: false,
            message: "Failed to load projects",
            data: [],
            count: 0
        });
    }
});

/* =========================================
   Post
   /api/airdrop/projects
========================================= */

router.post(
    "/projects",
    authMiddleware,
    async (req, res) => {

        try {

            const project =
                await projectService.createProject(
                    req.user.id,
                    req.body
                );

            return res.json({
                success: true,
                project
            });

        } catch (err) {

            console.error("[Projects CREATE]", err);

            return res.status(500).json({
                success: false,
                message: err.message || "Create failed"
            });
        }
    }
);

/* =========================================
   Put
   /api/airdrop/projects
========================================= */
router.put(
    "/projects/:id",
    authMiddleware,
    async (req, res) => {

        try {

            const ok =
                await projectService.updateProject(
                    req.user.id,
                    req.params.id,
                    req.body
                );

            return res.json({
            success: true,
            updated: ok
        });

        } catch (err) {

            console.error("[Projects UPDATE]", err);

            return res.status(500).json({
                success: false,
                message: "Update failed"
            });
        }
    }
);

/* =========================================
   DElete
========================================= */
router.delete(
    "/projects/:id",
    authMiddleware,
    async (req, res) => {

        try {

            const ok =
                await projectService.deleteProject(
                    req.user.id,
                    req.params.id
                );

            return res.json({
            success: true,
            deleted: ok
        });

        } catch (err) {

            console.error("[Projects DELETE]", err);

            return res.status(500).json({
                success: false,
                message: "Delete failed"
            });
        }
    }
);

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

    