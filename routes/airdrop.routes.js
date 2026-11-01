
// =============================================
// routes/airdrop.routes.js
// =============================================

"use strict";

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/auth");
const projectService = require("../services/airdrop.project.service");
const metricsService = require("../services/airdrop.metrics.service");

// =============================================
// RESPONSE HELPERS
// =============================================

function sendError(res, error, label = "AIRDROP", status = 500) {
    console.error(`[${label}]`, error);

    const message = error?.message || "Unexpected server error";

    return res.status(status).json({
        success: false,
        message: status >= 500 ? `${label} failed` : message
    });
}

function getUserId(req) {
    return req.user?.id || req.user?.user_id;
}

function requireUser(req, res) {
    const userId = getUserId(req);

    if (!userId) {
        res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
        return null;
    }

    return userId;
}

function handleStatus(error) {
    const message = error?.message || "";

    if (
        message.includes("không hợp lệ") ||
        message.includes("required") ||
        message.includes("Invalid") ||
        message.includes("must not") ||
        message.includes("not found")
    ) return 400;

    if (
        message.includes("Duplicate entry") ||
        message.includes("ER_DUP_ENTRY")
    ) return 409;

    return 500;
}

function sendSuccess(res, data, message = "Success", status = 200) {
    return res.status(status).json({
        success: true,
        message,
        data
    });
}

function csvEscape(value) {
    if (value === null || value === undefined) return '""';

    const text = typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

    return `"${text.replace(/"/g, '""')}"`;
}

// =============================================
// HEALTH
// =============================================

router.get("/health", (req, res) => {
    return sendSuccess(res, {
        service: "airdrop-tracking",
        status: "running"
    });
});

// =============================================
// PROJECTS
// =============================================

router.get("/projects", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getProjects(userId, {
            status: req.query.status,
            result: req.query.result,
            search: req.query.search,
            limit: req.query.limit,
            offset: req.query.offset
        });

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET PROJECTS", handleStatus(error));
    }
});

router.post("/projects", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.createProject(userId, req.body || {});

        return sendSuccess(res, data, "Project created", 201);
    } catch (error) {
        return sendError(res, error, "CREATE PROJECT", handleStatus(error));
    }
});

router.get("/projects/:id/tracking", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getProjectTracking(userId, req.params.id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "PROJECT TRACKING", handleStatus(error));
    }
});

router.get("/projects/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getProject(userId, req.params.id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET PROJECT", handleStatus(error));
    }
});

router.put("/projects/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.updateProject(
            userId,
            req.params.id,
            req.body || {}
        );

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        return sendSuccess(res, data, "Project updated");
    } catch (error) {
        return sendError(res, error, "UPDATE PROJECT", handleStatus(error));
    }
});

router.delete("/projects/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const deleted = await projectService.deleteProject(userId, req.params.id);

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        return sendSuccess(res, null, "Project archived");
    } catch (error) {
        return sendError(res, error, "ARCHIVE PROJECT", handleStatus(error));
    }
});

// =============================================
// PROJECT EXPORT
// =============================================

router.get("/projects/export/json", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const projects = await projectService.getProjects(userId, {
            limit: 500
        });

        const output = [];

        for (const project of projects) {
            const tracking = await projectService.getProjectTracking(
                userId,
                project.id
            );

            output.push(tracking);
        }

        return sendSuccess(res, output, "Project export ready");
    } catch (error) {
        return sendError(res, error, "EXPORT JSON", handleStatus(error));
    }
});

router.get("/projects/export/csv", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const projects = await projectService.getProjects(userId, {
            limit: 500
        });

        const headers = [
            "Project ID",
            "Project",
            "Network",
            "URL",
            "Status",
            "Result",
            "Start Date",
            "End Date",
            "Created At"
        ];

        const lines = [
            headers.map(csvEscape).join(","),
            ...projects.map(project => [
                project.id,
                project.name,
                project.network,
                project.url,
                project.status,
                project.result,
                project.start_date,
                project.end_date,
                project.created_at
            ].map(csvEscape).join(","))
        ];

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="airdrop-projects.csv"'
        );

        return res.send("\uFEFF" + lines.join("\r\n"));
    } catch (error) {
        return sendError(res, error, "EXPORT CSV", handleStatus(error));
    }
});

// =============================================
// WALLETS
// =============================================

router.get("/wallets", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getWallets(userId, {
            network: req.query.network,
            active: req.query.active === undefined
                ? undefined
                : req.query.active === "true" || req.query.active === "1"
        });

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET WALLETS", handleStatus(error));
    }
});

router.post("/wallets", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.createWallet(userId, req.body || {});

        return sendSuccess(res, data, "Wallet created", 201);
    } catch (error) {
        return sendError(res, error, "CREATE WALLET", handleStatus(error));
    }
});

router.put("/wallets/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.updateWallet(
            userId,
            req.params.id,
            req.body || {}
        );

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Wallet not found"
            });
        }

        return sendSuccess(res, data, "Wallet updated");
    } catch (error) {
        return sendError(res, error, "UPDATE WALLET", handleStatus(error));
    }
});

// =============================================
// PARTICIPATIONS
// =============================================

router.get("/participations", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getParticipations(userId, {
            project_id: req.query.project_id,
            wallet_id: req.query.wallet_id,
            result_status: req.query.result_status,
            claim_status: req.query.claim_status
        });

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET PARTICIPATIONS", handleStatus(error));
    }
});

router.post("/participations", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.createParticipation(
            userId,
            req.body || {}
        );

        return sendSuccess(res, data, "Participation created", 201);
    } catch (error) {
        return sendError(res, error, "CREATE PARTICIPATION", handleStatus(error));
    }
});

router.put("/participations/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.updateParticipation(
            userId,
            req.params.id,
            req.body || {}
        );

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Participation not found"
            });
        }

        return sendSuccess(res, data, "Participation updated");
    } catch (error) {
        return sendError(res, error, "UPDATE PARTICIPATION", handleStatus(error));
    }
});

// =============================================
// PARTICIPATION HISTORY
// =============================================

router.get(
    "/participations/:id/history",
    authMiddleware,
    async (req, res) => {
        try {
            const userId = requireUser(req, res);
            if (!userId) return;

            const data = await projectService.getParticipationHistory(
                userId,
                req.params.id
            );

            if (!data) {
                return res.status(404).json({
                    success: false,
                    message: "Participation not found"
                });
            }

            return sendSuccess(res, data);
        } catch (error) {
            return sendError(res, error, "GET HISTORY", handleStatus(error));
        }
    }
);

router.post(
    "/participations/:id/history",
    authMiddleware,
    async (req, res) => {
        try {
            const userId = requireUser(req, res);
            if (!userId) return;

            const data = await projectService.addParticipationHistory(
                userId,
                req.params.id,
                req.body || {}
            );

            return sendSuccess(res, data, "Activity recorded", 201);
        } catch (error) {
            return sendError(res, error, "ADD HISTORY", handleStatus(error));
        }
    }
);

// =============================================
// REWARDS
// =============================================

router.get("/rewards", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.getRewards(
            userId,
            req.query.participation_id
        );

        if (data === null) {
            return res.status(404).json({
                success: false,
                message: "Participation not found"
            });
        }

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET REWARDS", handleStatus(error));
    }
});

router.post("/rewards", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.createReward(userId, req.body || {});

        return sendSuccess(res, data, "Reward created", 201);
    } catch (error) {
        return sendError(res, error, "CREATE REWARD", handleStatus(error));
    }
});

router.put("/rewards/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await projectService.updateReward(
            userId,
            req.params.id,
            req.body || {}
        );

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Reward not found"
            });
        }

        return sendSuccess(res, data, "Reward updated");
    } catch (error) {
        return sendError(res, error, "UPDATE REWARD", handleStatus(error));
    }
});

router.delete("/rewards/:id", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const deleted = await projectService.deleteReward(userId, req.params.id);

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Reward not found"
            });
        }

        return sendSuccess(res, null, "Reward deleted");
    } catch (error) {
        return sendError(res, error, "DELETE REWARD", handleStatus(error));
    }
});

// =============================================
// LEGACY ANALYSIS API
// =============================================

router.post("/projects/:id/analyze", authMiddleware, (req, res) => {
    return res.status(410).json({
        success: false,
        code: "ANALYSIS_MOVED_TO_FRONTEND",
        message: "Project analysis is now calculated in the frontend."
    });
});


// =============================================
// PROJECT METRICS
// =============================================

router.get("/projects/:id/metrics", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await metricsService.getMetrics(userId, req.params.id);

        return sendSuccess(res, data);
    } catch (error) {
        return sendError(res, error, "GET METRICS", handleStatus(error));
    }
});

router.put("/projects/:id/metrics", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await metricsService.saveMetrics(
            userId,
            req.params.id,
            req.body || {}
        );

        return sendSuccess(res, data, "Metrics saved");
    } catch (error) {
        return sendError(res, error, "SAVE METRICS", handleStatus(error));
    }
});

router.patch("/projects/:id/metrics", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const data = await metricsService.updateMetrics(
            userId,
            req.params.id,
            req.body || {}
        );

        return sendSuccess(res, data, "Metrics updated");
    } catch (error) {
        return sendError(res, error, "UPDATE METRICS", handleStatus(error));
    }
});

router.delete("/projects/:id/metrics", authMiddleware, async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;

        const deleted = await metricsService.deleteMetrics(
            userId,
            req.params.id
        );

        return sendSuccess(res, { deleted }, "Metrics deleted");
    } catch (error) {
        return sendError(res, error, "DELETE METRICS", handleStatus(error));
    }
});

module.exports = router;
