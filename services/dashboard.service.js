// =========================================
// services/dashboard.service.js
// Part 1
// =========================================

"use strict";

/* =========================================
   SERVICES
========================================= */

const projectService =
    require("./airdrop.project.service");

const metricsService =
    require("./airdrop.metrics.service");

const investorService =
    require("./airdrop.investor.service");

const partnerService =
    require("./airdrop.partner.service");

const teamService =
    require("./airdrop.team.service");

const noteService =
    require("./airdrop.note.service");

const walletService =
    require("./airdrop.wallet.service");

const analysisService =
    require("./airdrop.analysis.service");

const alertService =
    require("./airdrop.alert.service");

const decisionEngine =
    require("./ai/airdrop.decision.engine");

const riskProfileService =
    require("./ai/airdrop.risk.profile.service");


/* =========================================
   BUILD MAP
========================================= */

function buildMap(rows = [], key = "project_id") {

    const map = new Map();

    for (const row of rows) {

        const id = Number(row[key]);

        if (!map.has(id)) {

            map.set(id, []);

        }

        map.get(id).push(row);

    }

    return map;

}


/* =========================================
   LOAD ALL DATA (BATCH)
========================================= */

async function loadAllData(userId) {

    const [

        projectResult,

        metrics,

        investors,

        partners,

        members,

        notes,

        walletRows

    ] = await Promise.all([

        projectService.getProjectsByUser(userId),

        metricsService.getAllMetrics(userId),

        investorService.getAllInvestors(userId),

        partnerService.getAllPartners(userId),

        teamService.getAllMembers(userId),

        noteService.getAllNotes(userId),

        walletService.getPortfolio(userId)

    ]);

    const projects =
        projectResult.data || [];


    return {

        projects,

        metrics,

        investors,

        partners,

        members,

        notes,

        walletRows,

        metricsMap:
            buildMap(metrics),

        investorMap:
            buildMap(investors),

        partnerMap:
            buildMap(partners),

        memberMap:
            buildMap(members),

        noteMap:
            buildMap(notes)

    };

}

/* =========================================
   GET FIRST ITEM
========================================= */

function first(list = []) {

    if (!Array.isArray(list)) {
        return null;
    }

    return list.length
        ? list[0]
        : null;

}

/* =========================================
   BUILD PROJECT CONTEXT
========================================= */

function buildProjectContext(
    project,
    maps
) {

    return {

        project,

        metrics:

            first(
                maps.metricsMap.get(project.id)
            ) || {},

        investors:

            maps.investorMap.get(project.id)
            || [],

        partners:

            maps.partnerMap.get(project.id)
            || [],

        team:

            maps.memberMap.get(project.id)
            || [],

        notes:

            maps.noteMap.get(project.id)
            || []

    };

}

/* =========================================
   BUILD ALL PROJECT CONTEXTS
========================================= */

function buildContexts(data) {

    const contexts = [];

    for (const project of data.projects) {

        contexts.push(

            buildProjectContext(
                project,
                data
            )

        );

    }

    return contexts;

}

/* =========================================
   PORTFOLIO SUMMARY
========================================= */

function buildPortfolio(data) {

    return walletService.analyzePortfolio(

        data.walletRows || []

    );

}

/* =========================================
   RISK PROFILE
========================================= */

function buildRiskProfile(portfolio) {

    const tokens =
        portfolio.tokens || [];

    let maxExposure = 0;

    for (const token of tokens) {

        if (
            token.value >
            maxExposure
        ) {

            maxExposure =
                token.value;

        }

    }

    const profileInput = {

        wallet_roi:
            portfolio.roi || 0,

        token_count:
            tokens.length,

        max_token_exposure:
            maxExposure,

        loss_rate: 0

    };

    return riskProfileService
        .buildRiskProfile(
            profileInput
        );

}

/* =========================================
   BUILD DATASET
========================================= */

function buildDataset(data) {

    const contexts =
        buildContexts(data);

    const portfolio =
        buildPortfolio(data);

    const riskProfile =
        buildRiskProfile(portfolio);

    return {

        contexts,

        portfolio,

        riskProfile

    };

}

/* =========================================
   ANALYZE PROJECTS
========================================= */

async function analyzeProjects(
    userId,
    dataset
) {

    const results = [];

    for (const context of dataset.contexts) {

        /* -----------------------------
           AI Analysis
        ----------------------------- */

        const analysis =
            analysisService.analyze(
                context
            );

        /* -----------------------------
           AI Decision
        ----------------------------- */

        const decision =
            await decisionEngine.analyzeDecision({

                userId,

                wallet:
                    dataset.portfolio,

                project:
                    context.project,

                metrics:
                    context.metrics,

                investors:
                    context.investors,

                partners:
                    context.partners,

                team:
                    context.team,

                notes:
                    context.notes

            });

        results.push({

            project:
                context.project,

            metrics:
                context.metrics,

            investors:
                context.investors,

            partners:
                context.partners,

            team:
                context.team,

            notes:
                context.notes,

            analysis,

            decision

        });

    }

    return results;

}


/* =========================================
   BUILD RANKING
========================================= */

function buildRanking(projects = []) {

    return [...projects]

        .sort(

            (a, b) =>

                (b.metrics.total_score || 0)

                -

                (a.metrics.total_score || 0)

        )

        .map((item, index) => ({

            rank:
                index + 1,

            project_id:
                item.project.id,

            project_name:
                item.project.name,

            score:
                item.metrics.total_score || 0,

            risk:
                item.metrics.risk_level || "-",

            decision:
                item.decision.action,

            confidence:
                item.decision.confidence

        }));

}


/* =========================================
   BUILD SUMMARY
========================================= */

function buildSummary(
    analyzed,
    alerts,
    riskProfile
) {

    let totalScore = 0;

    let highRisk = 0;

    for (const p of analyzed) {

        totalScore +=
            Number(
                p.metrics.total_score || 0
            );

        if (

            p.metrics.risk_level === "high" ||

            p.metrics.risk_level === "very-high"

        ) {

            highRisk++;

        }

    }

    return {

        total_projects:
            analyzed.length,

        average_score:

            analyzed.length

                ?

                Number(

                    (
                        totalScore /

                        analyzed.length

                    ).toFixed(2)

                )

                :

                0,

        high_risk_projects:
            highRisk,

        alert_count:
            alerts.total_alerts || 0,

        user_profile:
            riskProfile.profile,

        risk_score:
            riskProfile.risk_score

    };

}


/* =========================================
   LOAD ALERTS
========================================= */

async function loadAlerts(userId) {

    try {

        return await alertService.generateAlerts(
            userId
        );

    }

    catch (err) {

        console.error(
            "Alert Service:",
            err.message
        );

        return {

            total_alerts: 0,

            alerts: []

        };

    }

}
/* =========================================
   LOAD DASHBOARD
========================================= */

async function loadDashboard(userId) {

    /*
    ========================================
       1. LOAD RAW DATA
    ========================================
    */

    const data =
        await loadAllData(userId);


    /*
    ========================================
       2. BUILD DATASET
    ========================================
    */

    const dataset =
        buildDataset(data);


    /*
    ========================================
       3. ANALYZE PROJECTS
    ========================================
    */

    const projects =
        await analyzeProjects(
            userId,
            dataset
        );


    /*
    ========================================
       4. RANKING
    ========================================
    */

    const ranking =
        buildRanking(
            projects
        );


    /*
    ========================================
       5. ALERTS
    ========================================
    */

    const alerts =
        await loadAlerts(
            userId
        );


    /*
    ========================================
       6. SUMMARY
    ========================================
    */

    const summary =
        buildSummary(

            projects,

            alerts,

            dataset.riskProfile

        );


    /*
    ========================================
       RETURN DASHBOARD DATA
    ========================================
    */

    return {

        summary,


        ranking,


        projects,


        alerts,


        portfolio:

            dataset.portfolio,


        riskProfile:

            dataset.riskProfile

    };

}


/* =========================================
   EXPORTS
========================================= */

module.exports = {

    loadDashboard,


    // exposed for testing

    loadAllData,

    buildDataset,

    buildContexts,

    buildProjectContext,

    buildRanking,

    buildSummary

};