// =========================================
// routes/airdrop.routes.js
// =========================================

"use strict";

const express =
    require("express");

const router =
    express.Router();

const db =
    require("../config/db");

/* =========================================
   MIDDLEWARE
========================================= */

const authMiddleware =
    require("../middleware/auth");

const requirePlan =
    require("../middleware/requirePlan");

const loadAirdropProject =
    require("../middleware/loadAirdropProject");

const loadEntity =
    require("../middleware/loadEntity");

/* =========================================
   SERVICES
========================================= */

const scanService =
    require("../services/airdrop.scan.service");

const walletService =
    require("../services/airdrop.wallet.service");

const projectService =
    require("../services/airdrop.project.service");

const investorService =
    require("../services/airdrop.investor.service");

const partnerService =
    require("../services/airdrop.partner.service");

const noteService =
    require("../services/airdrop.note.service");

const teamService =
    require("../services/airdrop.team.service");

const contextService =
    require("../services/airdrop.context.service");

const analysisService =
    require("../services/airdrop.analysis.service");

const metricsService =
    require("../services/airdrop.metrics.service");

const dashboardService =
    require("../services/airdrop.dashboard.service");

const rankingService =
    require("../services/airdrop.ranking.service");

const alertService =
    require("../services/airdrop.alert.service");

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
   GET
   /api/airdrop/wallet/portfolio
========================================= */

router.get(
    "/wallet/portfolio",
    authMiddleware,
    async (req, res) => {

        try {

            const walletService =
                require("../services/airdrop.wallet.intelligence.service");

            const rows =
                await walletService.getPortfolio(req.user.id);

            const analysis =
                walletService.analyzePortfolio(rows);

            return res.json({
                success: true,
                ...analysis
            });

        } catch (err) {

            console.error("[Wallet Portfolio]", err);

            return res.status(500).json({
                success: false,
                message: "Failed to load portfolio"
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

router.get(
    "/projects/statistics",
    authMiddleware,
    async (req, res) => {

        try {

            const projects =
                await projectService.getProjects(
                    req.user.id
                );

            const total =
                projects.length;

            const eligible =
                projects.filter(
                    p => p.result === "eligible"
                ).length;

            const pending =
                projects.filter(
                    p => p.status === "pending"
                ).length;

            const rejected =
                projects.filter(
                    p => p.result === "rejected"
                ).length;

            const avgScore =
                total
                    ? projects.reduce(
                        (s, p) => s + Number(p.score || 0),
                        0
                    ) / total
                    : 0;

            res.json({

                success: true,

                totalProjects: total,

                eligibleProjects: eligible,

                pendingProjects: pending,

                rejectedProjects: rejected,

                averageScore:
                    Number(avgScore.toFixed(2))

            });

        }

        catch (err) {

            console.error(err);

            res.status(500).json({
                success: false,
                error: err.message
            });

        }

    }
);

router.get(
    "/projects/search",
    authMiddleware,
    async (req, res) => {

        try {

            const keyword =
                String(
                    req.query.q || ""
                );

            const projects =
                await projectService.getProjects(
                    req.user.id
                );

            const result =
                projects.filter(project => {

                    return (

                        (project.project_name || "")
                            .toLowerCase()
                            .includes(keyword.toLowerCase())

                        ||

                        (project.website || "")
                            .toLowerCase()
                            .includes(keyword.toLowerCase())

                    );

                });

            res.json({

                success: true,

                projects: result

            });

        }

        catch (err) {

            console.error(err);

            res.status(500).json({

                success: false,

                error: err.message

            });

        }

    }
);

/* =========================================
   GET
   /api/airdrop/projects/:id/analysis
========================================= */

router.get(
    "/projects/:id/analysis",
    authMiddleware,
    loadAirdropProject,
    async (req, res) => {

        try {

     const context =

    await contextService.getProjectContext(

        req.user.id,

        req.project.id

    );

        const analysis =
                analysisService.analyze(
                    context
                );

        await projectService.updateAnalysisScore(
                req.project.id,
                analysis.score?.overall_score || 0,
                analysis.risk?.risk_score || 0
            );

            return res.json({

                success: true,

                ...analysis

            });

        }

        catch (err) {

            console.error(

                "[Project Analysis]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Analysis failed."

            });

        }

    }
);

/* =========================================
   GET
   /api/airdrop/projects/:id/metrics
========================================= */

router.get(
    "/projects/:id/metrics",
    authMiddleware,
    loadAirdropProject,
    async (req, res) => {

        try {

       const metrics =

    await metricsService.getMetrics(

        req.project.id

    );

            return res.json({

                success: true,

                metrics

            });

        }

        catch (err) {

            console.error(

                "[Metrics GET]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Load metrics failed."

            });

        }

    }
);

/* =========================================
   PUT
   /api/airdrop/projects/:id/metrics
========================================= */

router.put(
    "/projects/:id/metrics",
    authMiddleware,
    loadAirdropProject,
    async (req, res) => {

        try {

            await metricsService.saveMetrics(

    req.project.id,

    req.body

);

            const metrics =
                await metricsService.getMetrics(

                    req.params.id

                );

            return res.json({

                success: true,

                metrics

            });

        }

        catch (err) {

            console.error(

                "[Metrics SAVE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Save metrics failed."

            });

        }

    }
);

/* =========================================
   DELETE
   /api/airdrop/projects/:id/metrics
========================================= */

router.delete(
    "/projects/:id/metrics",
    authMiddleware,
    loadAirdropProject,
    async (req, res) => {

        try {

            const deleted =
                await metricsService.deleteMetrics(

                    req.params.id

                );

            return res.json({

                success: true,

                deleted

            });

        }

        catch (err) {

            console.error(

                "[Metrics DELETE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Delete metrics failed."

            });

        }

    }
);

/* =========================================
   GET
   /api/airdrop/projects/:id/investors
========================================= */

router.get(

    "/projects/:id/investors",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const investors =

                await investorService.getInvestors(

                    req.project.id

                );

            return res.json({

                success: true,

                project_id:

                    req.project.id,

                total:

                    investors.length,

                investors

            });

        }

        catch (err) {

            console.error(

                "[Investors GET]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Failed to load investors."

            });

        }

    }

);

/* =========================================
   POST
   /api/airdrop/projects/:id/investors
========================================= */

router.post(

    "/projects/:id/investors",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const id =
                await investorService.createInvestor(

                    req.project.id,

                    req.body

                );

            const investor =
                await investorService.getInvestor(id);

            return res.json({

                success: true,

                message:
                    "Investor created.",

                investor

            });

        }

        catch (err) {

            console.error(

                "[Investor CREATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Create investor failed."

            });

        }

    }

);

/* =========================================
   PUT
   /api/airdrop/projects/:id/investors/:investorId
========================================= */

router.put(

    "/projects/:id/investors/:investorId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            investorService,

        method:
            "getInvestor",

        param:
            "investorId",

        assign:
            "investor",

        checkProject:
            true,

        notFoundMessage:
            "Investor not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await investorService.updateInvestor(

                    req.investor.id,

                    req.body

                );

            if (!ok) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Update failed."

                });

            }

            const investor =
                await investorService.getInvestor(

                    req.investor.id

                );

            return res.json({

                success: true,

                message:
                    "Investor updated.",

                investor

            });

        }

        catch (err) {

            console.error(

                "[Investor UPDATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Update investor failed."

            });

        }

    }

);

/* =========================================
   DELETE
   /api/airdrop/projects/:id/investors/:investorId
========================================= */

router.delete(

    "/projects/:id/investors/:investorId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            investorService,

        method:
            "getInvestor",

        param:
            "investorId",

        assign:
            "investor",

        checkProject:
            true,

        notFoundMessage:
            "Investor not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await investorService.deleteInvestor(

                    req.investor.id

                );

            return res.json({

                success: true,

                deleted: ok,

                investor_id:
                    req.investor.id

            });

        }

        catch (err) {

            console.error(

                "[Investor DELETE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Delete investor failed."

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/projects/:id/partners
========================================= */

router.get(

    "/projects/:id/partners",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const partners =

                await partnerService.getPartners(

                    req.project.id

                );

            return res.json({

                success: true,

                project_id:

                    req.project.id,

                total:

                    partners.length,

                partners

            });

        }

        catch (err) {

            console.error(

                "[Partners GET]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Failed to load partners."

            });

        }

    }

);

/* =========================================
   POST
   /api/airdrop/projects/:id/partners
========================================= */

router.post(

    "/projects/:id/partners",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const id =
                await partnerService.createPartner(

                    req.project.id,

                    req.body

                );

            const partner =
                await partnerService.getPartner(

                    id

                );

            return res.status(201).json({

                success: true,

                message:
                    "Partner created.",

                partner

            });

        }

        catch (err) {

            console.error(

                "[Partner CREATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Create partner failed."

            });

        }

    }

);

/* =========================================
   PUT
   /api/airdrop/projects/:id/partners/:partnerId
========================================= */

router.put(

    "/projects/:id/partners/:partnerId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            partnerService,

        method:
            "getPartner",

        param:
            "partnerId",

        assign:
            "partner",

        checkProject:
            true,

        notFoundMessage:
            "Partner not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await partnerService.updatePartner(

                    req.partner.id,

                    req.body

                );

            if (!ok) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Update failed."

                });

            }

            const partner =
                await partnerService.getPartner(

                    req.partner.id

                );

            return res.json({

                success: true,

                message:
                    "Partner updated.",

                partner

            });

        }

        catch (err) {

            console.error(

                "[Partner UPDATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Update partner failed."

            });

        }

    }

);

/* =========================================
   DELETE
   /api/airdrop/projects/:id/partners/:partnerId
========================================= */

router.delete(

    "/projects/:id/partners/:partnerId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            partnerService,

        method:
            "getPartner",

        param:
            "partnerId",

        assign:
            "partner",

        checkProject:
            true,

        notFoundMessage:
            "Partner not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await partnerService.deletePartner(

                    req.partner.id

                );

            return res.json({

                success: true,

                deleted: ok,

                partner_id:
                    req.partner.id

            });

        }

        catch (err) {

            console.error(

                "[Partner DELETE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Delete partner failed."

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/projects/:id/team
========================================= */

router.get(

    "/projects/:id/team",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const members =

                await teamService.getMembers(

                    req.project.id

                );

            return res.json({

                success: true,

                project_id:
                    req.project.id,

                total:
                    members.length,

                members

            });

        }

        catch (err) {

            console.error(

                "[Team GET]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Failed to load team."

            });

        }

    }

);

/* =========================================
   POST
   /api/airdrop/projects/:id/team
========================================= */

router.post(

    "/projects/:id/team",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const id =
                await teamService.createMember(

                    req.project.id,

                    req.body

                );

            const member =
                await teamService.getMember(

                    id

                );

            return res.status(201).json({

                success: true,

                message:
                    "Member created.",

                member

            });

        }

        catch (err) {

            console.error(

                "[Team CREATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Create member failed."

            });

        }

    }

);

/* =========================================
   PUT
   /api/airdrop/projects/:id/team/:memberId
========================================= */

router.put(

    "/projects/:id/team/:memberId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            teamService,

        method:
            "getMember",

        param:
            "memberId",

        assign:
            "member",

        checkProject:
            true,

        notFoundMessage:
            "Team member not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await teamService.updateMember(

                    req.member.id,

                    req.body

                );

            if (!ok) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Update failed."

                });

            }

            const member =
                await teamService.getMember(

                    req.member.id

                );

            return res.json({

                success: true,

                message:
                    "Member updated.",

                member

            });

        }

        catch (err) {

            console.error(

                "[Team UPDATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Update member failed."

            });

        }

    }

);

/* =========================================
   DELETE
   /api/airdrop/projects/:id/team/:memberId
========================================= */

router.delete(

    "/projects/:id/team/:memberId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            teamService,

        method:
            "getMember",

        param:
            "memberId",

        assign:
            "member",

        checkProject:
            true,

        notFoundMessage:
            "Team member not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await teamService.deleteMember(

                    req.member.id

                );

            return res.json({

                success: true,

                deleted: ok,

                member_id:
                    req.member.id

            });

        }

        catch (err) {

            console.error(

                "[Team DELETE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Delete member failed."

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/projects/:id/notes
========================================= */

router.get(

    "/projects/:id/notes",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const notes =

                await noteService.getNotes(

                    req.project.id

                );

            return res.json({

                success: true,

                project_id:
                    req.project.id,

                total:
                    notes.length,

                notes

            });

        }

        catch (err) {

            console.error(

                "[Notes GET]",

                err

            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Failed to load notes."

            });

        }

    }

);

/* =========================================
   POST
   /api/airdrop/projects/:id/notes
========================================= */

router.post(

    "/projects/:id/notes",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const id =
                await noteService.createNote(

                    req.project.id,

                    req.user.id,

                    req.body.note
                );

            const note =
                await noteService.getNote(id);

            return res.status(201).json({

                success: true,

                message:
                    "Note created.",

                note

            });

        }

        catch (err) {

            console.error(

                "[Notes CREATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Create note failed."

            });

        }

    }

);

/* =========================================
   PUT
   /api/airdrop/projects/:id/notes/:noteId
========================================= */

router.put(

    "/projects/:id/notes/:noteId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            noteService,

        method:
            "getNote",

        param:
            "noteId",

        assign:
            "note",

        checkProject:
            true,

        notFoundMessage:
            "Note not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await noteService.updateNote(

                    req.note.id,

                    req.body.note

                );

            if (!ok) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Update failed."

                });

            }

            const updated =
                await noteService.getNote(

                    req.note.id

                );

            return res.json({

                success: true,

                message:
                    "Note updated.",

                note:
                    updated

            });

        }

        catch (err) {

            console.error(

                "[Notes UPDATE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Update note failed."

            });

        }

    }

);

/* =========================================
   DELETE
   /api/airdrop/projects/:id/notes/:noteId
========================================= */

router.delete(

    "/projects/:id/notes/:noteId",

    authMiddleware,

    loadAirdropProject,

    loadEntity({

        service:
            noteService,

        method:
            "getNote",

        param:
            "noteId",

        assign:
            "note",

        checkProject:
            true,

        notFoundMessage:
            "Note not found."

    }),

    async (req, res) => {

        try {

            const ok =
                await noteService.deleteNote(

                    req.note.id

                );

            return res.json({

                success: true,

                deleted: ok,

                note_id:
                    req.note.id

            });

        }

        catch (err) {

            console.error(

                "[Notes DELETE]",

                err

            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||

                    "Delete note failed."

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/projects/:id/context
========================================= */

router.get(

    "/projects/:id/context",

    authMiddleware,

    async (req, res) => {

        try {

            const data =
                await contextService.getProjectContext(
                    req.user.id,
                    req.params.id
                );

            if (!data) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Project not found"

                });

            }

            return res.json({

                success: true,

                ...data

            });

        }

        catch (err) {

            console.error(

                "[PROJECT CONTEXT]",

                err

            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||
                    "Failed to load project context"

            });

        }

    }

);

/* =========================================
   POST
   /api/airdrop/projects/:id/sync
========================================= */

router.post(

    "/projects/:id/sync",

    authMiddleware,

    loadAirdropProject,

    async (req, res) => {

        try {

            const collectorService =
                require("../services/airdrop.data.collector.service");


            const result =
                await collectorService.collectProjectData(
                    req.project.id
                );


            return res.json({

                success: true,

                message:
                    "Project synced successfully.",

                data:
                    result

            });


        }

        catch (err) {


            console.error(
                "[PROJECT SYNC]",
                err
            );


            return res.status(500).json({

                success:false,

                message:
                    err.message ||
                    "Sync failed."

            });


        }

    }

);
/* =========================================
   GET
   /api/airdrop/dashboard
========================================= */

router.get(

    "/dashboard",

    authMiddleware,

    async (req, res) => {

        try {

            const data =
                await dashboardService.getDashboard(
                    req.user.id
                );

            return res.json({

                success: true,

                ...data

            });

        }

        catch (err) {

            console.error(
                "[DASHBOARD]",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||
                    "Failed to load dashboard"

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/ranking
========================================= */

router.get(

    "/ranking",

    authMiddleware,

    async (req, res) => {

        try {

            const data =
                await rankingService.getRanking(
                    req.user.id,
                    {
                        mode: req.query.mode
                    }
                );

            return res.json({

                success: true,

                ...data

            });

        }

        catch (err) {

            console.error(
                "[RANKING]",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||
                    "Failed to load ranking"

            });

        }

    }

);

/* =========================================
   GET
   /api/airdrop/alerts
========================================= */

router.get(

    "/alerts",

    authMiddleware,

    async (req, res) => {

        try {

            const data =
                await alertService.generateAlerts(
                    req.user.id
                );

            return res.json({

                success: true,

                ...data

            });

        }

        catch (err) {

            console.error(
                "[ALERTS]",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    err.message ||
                    "Failed to generate alerts"

            });

        }

    }

);

router.get(
    "/intelligence/dashboard",
    authMiddleware,
    async (req, res) => {

        try {

            const dashboardService =
                require("../services/airdrop.intelligence.dashboard.service");

            const data =
                await dashboardService.getDashboard(req.user.id);

            return res.json({
                success: true,
                ...data
            });

        } catch (err) {

            console.error("[DASHBOARD]", err);

            return res.status(500).json({
                success: false,
                message: "Dashboard failed"
            });
        }
    }
);

router.get(
    "/ai/decision/:projectId",
    authMiddleware,
    async (req, res) => {

        const decisionEngine =
            require("../services/ai/airdrop.decision.engine");

        const projectService =
            require("../services/airdrop.project.service");

        const walletService =
            require("../services/airdrop.wallet.intelligence.service");

        const project =
            await projectService.getProjectById(
                req.user.id,
                req.params.projectId
            );

        const metrics =
            await metricsService.getMetrics(
                req.params.projectId
            );

        const wallet =
            await walletService.getPortfolio(req.user.id);

        const result =
            decisionEngine.analyzeDecision({
                wallet,
                project,
                metrics
            });

        res.json({
            success: true,
            ...result
        });
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

router.patch(
    "/projects/:id/watchlist",
    authMiddleware,
    async (req,res)=>{

        try {

            const result =
                await projectService.updateWatchlist(
                    req.params.id,
                    req.body.watchlist
                );


            res.json(result);

        }
        catch(err){

            console.error(
                "[WATCHLIST UPDATE]",
                err
            );


            res.status(500).json({
                error:err.message
            });

        }

    }
);

/* =========================================
   EXPORT
========================================= */

module.exports =
    router;

    