
// =============================================
// services/airdrop.metrics.service.js
// =============================================

"use strict";

const db = require("../db");
const connection = typeof db.promise === "function" ? db.promise() : db;

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 && Array.isArray(result[1])
        ? result[0]
        : result;
}

function requireId(value, label = "ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`${label} không hợp lệ`);
    }
    return id;
}

const RAW_COLUMNS = [
    "token_symbol", "current_price", "total_supply", "circulating_supply",
    "max_supply", "market_cap", "fdv", "volume_24h", "liquidity",
    "price_change_24h", "tvl", "tvl_growth_7d", "tvl_growth_30d",
    "protocol_fee", "protocol_revenue", "revenue_growth_30d", "treasury",
    "cash_runway_months", "monthly_operating_expenses", "stablecoin_reserve", "token_buyback", "token_burn",
    "holders", "transactions_24h", "seed_price", "private_price", "public_price",
    "ath_price", "atl_price", "funding_amount", "github_stars", "github_forks",
    "github_watchers", "github_contributors", "github_recent_commits",
    "github_releases", "followers", "total_experience", "big_companies",
    "education_count"
];

const NUMERIC_COLUMNS = RAW_COLUMNS.filter(field => field !== "token_symbol");

const DERIVED_COLUMNS = [
    "circulating_percent", "locked_percent", "inflation", "seed_roi",
    "private_roi", "public_roi", "fair_buy_price", "fair_sell_price"
];

const NOT_NULL_RAW_COLUMNS = new Set([
    "tvl", "tvl_growth_7d", "tvl_growth_30d", "protocol_fee",
    "protocol_revenue", "revenue_growth_30d", "treasury",
    "cash_runway_months", "stablecoin_reserve", "token_buyback",
    "token_burn", "holders", "transactions_24h", "github_stars",
    "github_forks", "github_watchers", "github_contributors",
    "github_recent_commits", "github_releases", "followers",
    "total_experience", "big_companies", "education_count"
]);

// =============================================
// FUNDAMENTALS CONFIG
// =============================================

const FUNDAMENTALS_WEIGHTS = {
    team_score: 15,
    investor_score: 10,
    partner_score: 10,
    tokenomics_score: 20,
    community_score: 10,
    development_score: 15,
    financial_score: 10,
    onchain_score: 10
};

const COMPONENTS = Object.keys(FUNDAMENTALS_WEIGHTS);
const MIN_BENCHMARK_PROJECTS = 5;
const MIN_FUNDAMENTALS_COMPONENTS = 5;
const MIN_FUNDAMENTALS_WEIGHT = 60;

const BENCHMARK_COLUMNS = [
    "followers", "holders", "github_contributors",
    "github_recent_commits", "github_releases", "github_stars",
    "github_forks", "github_watchers", "tvl", "protocol_revenue",
    "protocol_fee", "tvl_growth_30d", "revenue_growth_30d",
    "treasury", "stablecoin_reserve", "transactions_24h",
    "volume_24h", "liquidity"
];

const BENCHMARK_NON_NEGATIVE = new Set(
    BENCHMARK_COLUMNS.filter(field =>
        !["tvl_growth_30d", "revenue_growth_30d"].includes(field)
    )
);

// =============================================
// NORMALIZE
// =============================================

function normalizeMetrics(data = {}) {
    const result = {};

    for (const field of RAW_COLUMNS) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) continue;

        const value = data[field];

        if (value === undefined) continue;

        if (field === "token_symbol") {
            const symbol = value === null ? "" : String(value).trim();
            result[field] = symbol ? symbol.slice(0, 30) : null;
            continue;
        }

        if (value === null || value === "") {
            result[field] = null;
            continue;
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            throw new Error(`Invalid numeric value: ${field}`);
        }

        result[field] = number;
    }

    return result;
}

// =============================================
// JSON STATUS HELPERS
// =============================================

function parseJSONStatus(value) {
    if (!value) return {};

    if (typeof value === "object" && !Array.isArray(value)) {
        return { ...value };
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function parseFieldStatus(value) {
    return parseJSONStatus(value);
}

function parseEvaluationScoreStatus(value) {
    return parseJSONStatus(value);
}

function buildFieldStatus(currentStatus, values, sourceByField = {}) {
    const status = parseFieldStatus(currentStatus);
    const now = Math.floor(Date.now() / 1000);

    for (const [field, value] of Object.entries(values)) {
        const source = typeof sourceByField[field] === "string"
            ? sourceByField[field].trim().slice(0, 60)
            : "manual";

        const available = value !== null &&
            !(typeof value === "string" && value.trim() === "");

        status[field] = {
            available,
            source: source || "manual",
            updated_at: now
        };
    }

    return status;
}

function normalizeDatabaseValues(values) {
    const result = { ...values };

    for (const [field, value] of Object.entries(result)) {
        if (value === null && NOT_NULL_RAW_COLUMNS.has(field)) {
            result[field] = 0;
        }
    }

    return result;
}

// =============================================
// SOURCE PRIORITY
// =============================================

function filterIncomingValues(current, values, sourceByField = {}) {
    const status = parseFieldStatus(current?.metrics_field_status);
    const accepted = {};

    for (const [field, value] of Object.entries(values)) {
        const incomingSource = String(
            sourceByField[field] || "manual"
        ).toLowerCase();

        const existing = status[field] || {};
        const existingSource = String(existing.source || "").toLowerCase();

        // Bảo vệ dữ liệu thủ công hợp lệ khỏi API.
        // Dữ liệu default luôn được phép cập nhật.
        if (
            existingSource === "manual" &&
            existing.available === true &&
            incomingSource !== "manual"
        ) continue;

        accepted[field] = value;
    }

    return accepted;
}
// =============================================
// RAW METRIC VALIDATION
// =============================================

function isMetricAvailable(metrics, field) {
    const status = parseFieldStatus(metrics?.metrics_field_status);
    return status[field]?.available === true;
}

function getValidMetric(metrics, field) {
    if (!metrics || !field || !isMetricAvailable(metrics, field)) {
        return null;
    }

    const rawValue = metrics[field];

    if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
    }

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
}

function calculateRatio(numerator, denominator) {
    if (
        numerator === null ||
        denominator === null ||
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        numerator < 0 ||
        denominator <= 0 ||
        numerator > denominator
    ) {
        return null;
    }

    return (numerator / denominator) * 100;
}

function calculateROI(currentPrice, entryPrice) {
    if (
        currentPrice === null ||
        entryPrice === null ||
        !Number.isFinite(currentPrice) ||
        !Number.isFinite(entryPrice) ||
        entryPrice <= 0
    ) {
        return null;
    }

    return Number(((currentPrice / entryPrice - 1) * 100).toFixed(8));
}

// =============================================
// HISTORICAL METRICS + GROWTH
// =============================================

const HISTORY_FIELDS = ["tvl", "protocol_revenue"];

const HISTORY_LOOKBACK_SECONDS = 2 * 86400;

async function recordMetricHistory(projectId, values, sourceByField = {}) {
    const now = Math.floor(Date.now() / 1000);

    for (const field of HISTORY_FIELDS) {
        const source = String(sourceByField[field] || "").toLowerCase();
        const value = values[field];

        if (
            !["api", "fetch"].includes(source) ||
            value === null ||
            value === undefined ||
            !Number.isFinite(Number(value)) ||
            Number(value) < 0
        ) continue;

        await query(
            `INSERT INTO airdrop_metric_history
             (project_id, metric_key, metric_value, source, recorded_at)
             VALUES (?, ?, ?, 'api', ?)`,
            [projectId, field, Number(value), now]
        );
    }
}

async function getMetricHistory(projectId) {
    return query(
        `SELECT metric_key, metric_value, recorded_at
         FROM airdrop_metric_history
         WHERE project_id = ?
           AND metric_key IN ('tvl', 'protocol_revenue')
           AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
        [projectId, Math.floor(Date.now() / 1000) - 35 * 86400]
    );
}

function calculateHistoricalGrowth(currentValue, historyRows, field, days) {
    if (
        !Number.isFinite(currentValue) ||
        currentValue < 0
    ) return null;

    const now = Math.floor(Date.now() / 1000);
    const target = now - days * 86400;

    const baselineRows = historyRows
        .filter(row =>
            row.metric_key === field &&
            Number.isFinite(Number(row.metric_value)) &&
            Number(row.recorded_at) <= target &&
            Number(row.recorded_at) >= target - HISTORY_LOOKBACK_SECONDS
        )
        .sort((a, b) => Number(b.recorded_at) - Number(a.recorded_at));

    if (!baselineRows.length) return null;

    const baseline = Number(baselineRows[0].metric_value);

    if (!Number.isFinite(baseline) || baseline <= 0) return null;

    return Number(((currentValue / baseline - 1) * 100).toFixed(8));
}

function calculateCashRunway(treasury, monthlyExpenses) {
    if (
        !Number.isFinite(treasury) ||
        !Number.isFinite(monthlyExpenses) ||
        treasury < 0 ||
        monthlyExpenses <= 0
    ) return null;

    return Number((treasury / monthlyExpenses).toFixed(4));
}
// =============================================
// DERIVED INDICATORS ENGINE
// =============================================

// =============================================
// DERIVED INDICATORS ENGINE
// =============================================

function calculateDerivedIndicators(metrics, historyRows = []) {
    const circulatingSupply = getValidMetric(metrics, "circulating_supply");
    const totalSupply = getValidMetric(metrics, "total_supply");
    const currentPrice = getValidMetric(metrics, "current_price");

    const seedPrice = getValidMetric(metrics, "seed_price");
    const privatePrice = getValidMetric(metrics, "private_price");
    const publicPrice = getValidMetric(metrics, "public_price");

    const tvl = getValidMetric(metrics, "tvl");
    const revenue = getValidMetric(metrics, "protocol_revenue");

    const treasury = getValidMetric(metrics, "treasury");
    const monthlyExpenses = getValidMetric(
        metrics,
        "monthly_operating_expenses"
    );

    const circulatingPercent = calculateRatio(
        circulatingSupply,
        totalSupply
    );

    const maxSupply = getValidMetric(metrics, "max_supply");

    const marketCap = currentPrice !== null && circulatingSupply !== null
        ? currentPrice * circulatingSupply
        : null;

    const fdv = currentPrice !== null && maxSupply !== null && maxSupply > 0
        ? currentPrice * maxSupply
        : null;
    return {
        circulating_percent: circulatingPercent,
        locked_percent: circulatingPercent === null
            ? null
            : Number((100 - circulatingPercent).toFixed(8)),

        seed_roi: calculateROI(currentPrice, seedPrice),
        private_roi: calculateROI(currentPrice, privatePrice),
        public_roi: calculateROI(currentPrice, publicPrice),

        tvl_growth_7d: tvl === null
            ? null
            : calculateHistoricalGrowth(tvl, historyRows, "tvl", 7),

        tvl_growth_30d: tvl === null
            ? null
            : calculateHistoricalGrowth(tvl, historyRows, "tvl", 30),

        revenue_growth_30d: revenue === null
            ? null
            : calculateHistoricalGrowth(
                revenue,
                historyRows,
                "protocol_revenue",
                30
            ),

            market_cap: marketCap,
                fdv,

        cash_runway_months: calculateCashRunway(
            treasury,
            monthlyExpenses
        )
    };
}

async function recalculateDerivedIndicators(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const metrics = await getMetrics(uid, pid);
    if (!metrics) return null;

    const historyRows = await getMetricHistory(pid);
    const calculated = calculateDerivedIndicators(metrics, historyRows);

    const fieldStatus = parseFieldStatus(metrics.metrics_field_status);
    const updates = {};

    for (const [field, calculatedValue] of Object.entries(calculated)) {
        const previous = fieldStatus[field] || {};
        const previousSource = String(previous.source || "").toLowerCase();

        const isProtectedSource =
            ["manual", "api", "fetch"].includes(previousSource) &&
            previous.available === true;

        const value = isProtectedSource
            ? metrics[field] === null || metrics[field] === undefined
                ? null
                : Number(metrics[field])
            : calculatedValue;

        updates[field] = value;

        if (!isProtectedSource) {
            fieldStatus[field] = {
                available: value !== null && Number.isFinite(Number(value)),
                source: "calculated",
                updated_at: Math.floor(Date.now() / 1000)
            };
        }
    }

    const fields = Object.keys(updates);
    if (!fields.length) return {};

    await query(
        `UPDATE airdrop_project_metrics
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             metrics_field_status = ?
         WHERE project_id = ?`,
        [
            ...fields.map(field => updates[field]),
            JSON.stringify(fieldStatus),
            pid
        ]
    );

    return updates;
}
// =============================================
// SCORING HELPERS
// =============================================

function clampScore(value) {
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.max(0, Math.min(100, value)));
}

function scoreFromLog(value, cap) {
    if (!Number.isFinite(value) || value < 0 || cap <= 0) return null;

    return clampScore(
        100 * Math.min(1, Math.log1p(value) / Math.log1p(cap))
    );
}

function weightedAverage(items) {
    const valid = items.filter(item =>
        Number.isFinite(item.score) &&
        Number.isFinite(item.weight) &&
        item.weight > 0
    );

    if (!valid.length) return null;

    const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    const totalScore = valid.reduce(
        (sum, item) => sum + item.score * item.weight,
        0
    );

    return clampScore(totalScore / totalWeight);
}

function scoreGrowth(value) {
    if (!Number.isFinite(value)) return null;

    const bands = [
        [-50, 20],
        [0, 50],
        [25, 75],
        [50, 90],
        [100, 100]
    ];

    if (value <= bands[0][0]) return 0;
    if (value >= bands[bands.length - 1][0]) return 100;

    for (let i = 0; i < bands.length - 1; i++) {
        const [x1, y1] = bands[i];
        const [x2, y2] = bands[i + 1];

        if (value >= x1 && value <= x2) {
            return clampScore(
                y1 + ((value - x1) / (x2 - x1)) * (y2 - y1)
            );
        }
    }

    return null;
}

function scoreRunway(months) {
    if (!Number.isFinite(months) || months < 0) return null;
    return clampScore(Math.min(100, (months / 36) * 100));
}

// =============================================
// BENCHMARK ENGINE
// =============================================

function normalizeProjectName(value) {
    return String(value || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function compareUpdatedAt(a, b) {
    const av = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bv = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return (Number.isFinite(bv) ? bv : 0) - (Number.isFinite(av) ? av : 0);
}

function deduplicateBenchmarkProjects(rows, currentProjectId) {
    const sorted = [...rows].sort((a, b) => {
        if (Number(a.project_id) === Number(currentProjectId)) return -1;
        if (Number(b.project_id) === Number(currentProjectId)) return 1;
        return compareUpdatedAt(a, b);
    });

    const seen = new Set();
    const result = [];

    for (const row of sorted) {
        const key = normalizeProjectName(row.name);

        if (!key || seen.has(key)) continue;

        seen.add(key);
        result.push(row);
    }

    return result;
}

async function getBenchmarkProjects(project, currentProjectId) {
    if (!project?.network || !project?.category) return [];

    const rows = await query(
        `SELECT
            p.id AS project_id,
            p.name,
            m.metrics_field_status,
            m.updated_at,
            ${BENCHMARK_COLUMNS.map(field => `m.${field}`).join(", ")}
         FROM airdrop_projects p
         INNER JOIN airdrop_project_metrics m
            ON m.project_id = p.id
         WHERE LOWER(TRIM(p.network)) = LOWER(TRIM(?))
           AND LOWER(TRIM(p.category)) = LOWER(TRIM(?))`,
        [project.network, project.category]
    );

    return deduplicateBenchmarkProjects(rows, currentProjectId);
}

function getBenchmarkValue(row, field) {
    if (!row) return null;

    const status = parseFieldStatus(row.metrics_field_status);

    if (status[field]?.available !== true) return null;

    const value = Number(row[field]);

    if (!Number.isFinite(value)) return null;

    if (BENCHMARK_NON_NEGATIVE.has(field) && value < 0) {
        return null;
    }

    return value;
}

function calculatePercentile(value, values) {
    if (!Number.isFinite(value)) return null;

    const valid = values.filter(Number.isFinite);
    const count = valid.length;

    if (count < MIN_BENCHMARK_PROJECTS) return null;

    const less = valid.filter(item => item < value).length;
    const equal = valid.filter(item => item === value).length;

    if (count === 1) return null;

    // Average rank: đồng hạng nhận cùng percentile.
    const averageRank = less + (equal - 1) / 2;

    return clampScore((averageRank / (count - 1)) * 100);
}

function getPercentileScore(projectMetrics, benchmarkRows, field) {
    const value = getValidMetric(projectMetrics, field);
    if (value === null) return null;

    const values = benchmarkRows
        .map(row => getBenchmarkValue(row, field))
        .filter(Number.isFinite);

    if (values.length < MIN_BENCHMARK_PROJECTS) return null;

    return calculatePercentile(value, values);
}

function getBenchmarkScoreMap(metrics, benchmarkRows, fields) {
    const result = {};

    for (const field of fields) {
        result[field] = getPercentileScore(metrics, benchmarkRows, field);
    }

    return result;
}

// =============================================
// FUNDAMENTALS COMPONENT SCORING
// =============================================

function calculateTeamScore(metrics) {
    const experience = getValidMetric(metrics, "total_experience");
    const bigCompanies = getValidMetric(metrics, "big_companies");
    const educationCount = getValidMetric(metrics, "education_count");

    return weightedAverage([
        { score: scoreFromLog(experience, 15), weight: 50 },
        { score: scoreFromLog(bigCompanies, 3), weight: 30 },
        { score: scoreFromLog(educationCount, 2), weight: 20 }
    ]);
}

function calculateCommunityScore(scoreMap) {
    return weightedAverage([
        { score: scoreMap.followers, weight: 60 },
        { score: scoreMap.holders, weight: 40 }
    ]);
}

function calculateDevelopmentScore(scoreMap) {
    return weightedAverage([
        { score: scoreMap.github_contributors, weight: 25 },
        { score: scoreMap.github_recent_commits, weight: 30 },
        { score: scoreMap.github_releases, weight: 15 },
        { score: scoreMap.github_stars, weight: 15 },
        { score: scoreMap.github_forks, weight: 10 },
        { score: scoreMap.github_watchers, weight: 5 }
    ]);
}

function calculateFinancialScore(metrics, scoreMap) {
    return weightedAverage([
        { score: scoreMap.tvl, weight: 25 },
        { score: scoreMap.protocol_revenue, weight: 20 },
        { score: scoreMap.protocol_fee, weight: 10 },
        {
            score: scoreGrowth(getValidMetric(metrics, "tvl_growth_30d")),
            weight: 15
        },
        {
            score: scoreGrowth(getValidMetric(metrics, "revenue_growth_30d")),
            weight: 10
        },
        {
            score: scoreRunway(getValidMetric(metrics, "cash_runway_months")),
            weight: 10
        },
        { score: scoreMap.treasury, weight: 5 },
        { score: scoreMap.stablecoin_reserve, weight: 5 }
    ]);
}

function calculateOnchainScore(scoreMap) {
    return weightedAverage([
        { score: scoreMap.transactions_24h, weight: 30 },
        { score: scoreMap.holders, weight: 20 },
        { score: scoreMap.tvl, weight: 20 },
        { score: scoreMap.volume_24h, weight: 15 },
        { score: scoreMap.liquidity, weight: 15 }
    ]);
}

async function calculateAutoFundamentals(metrics, project, projectId) {
    const benchmarkRows = await getBenchmarkProjects(project, projectId);

    const scoreMap = getBenchmarkScoreMap(
        metrics,
        benchmarkRows,
        BENCHMARK_COLUMNS
    );

    return {
        team_score: calculateTeamScore(metrics),
        investor_score: null,
        partner_score: null,
        tokenomics_score: null,
        community_score: calculateCommunityScore(scoreMap),
        development_score: calculateDevelopmentScore(scoreMap),
        financial_score: calculateFinancialScore(metrics, scoreMap),
        onchain_score: calculateOnchainScore(scoreMap)
    };
}

// =============================================
// MANUAL OVERRIDE + FUNDAMENTALS AGGREGATION
// =============================================

function resolveEffectiveScores(autoScores, previousStatus) {
    const status = { ...previousStatus };
    const effectiveScores = {};

    for (const component of COMPONENTS) {
        const previous = status[component] || {};
        const autoScore = clampScore(autoScores[component]);

        const manualOverride = previous.manual_override === true;
        const manualScore = clampScore(
            previous.manual_score === null ||
            previous.manual_score === undefined
                ? NaN
                : Number(previous.manual_score)
        );

        const effectiveScore = manualOverride && manualScore !== null
            ? manualScore
            : autoScore;

        effectiveScores[component] = effectiveScore;

        status[component] = {
            auto_score: autoScore,
            manual_override: manualOverride,
            manual_score: manualOverride ? manualScore : null,
            source: manualOverride && manualScore !== null ? "manual" : "auto",
            updated_at: Math.floor(Date.now() / 1000)
        };
    }

    return { status, effectiveScores };
}

function calculateFundamentalsScore(effectiveScores) {
    const valid = COMPONENTS
        .map(component => ({
            component,
            score: effectiveScores[component],
            weight: FUNDAMENTALS_WEIGHTS[component]
        }))
        .filter(item => Number.isFinite(item.score));

    const validWeight = valid.reduce((sum, item) => sum + item.weight, 0);

    if (
        valid.length < MIN_FUNDAMENTALS_COMPONENTS ||
        validWeight < MIN_FUNDAMENTALS_WEIGHT
    ) {
        return null;
    }

    return weightedAverage(
        valid.map(item => ({
            score: item.score,
            weight: item.weight
        }))
    );
}

async function recalculateEvaluationScores(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const metrics = await getMetrics(uid, pid);
    if (!metrics) return null;

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const autoScores = await calculateAutoFundamentals(
        metrics,
        project,
        pid
    );

    const previousStatus = parseEvaluationScoreStatus(
        metrics.evaluation_score_status
    );

    const { status, effectiveScores } = resolveEffectiveScores(
        autoScores,
        previousStatus
    );

    const fundamentalsScore = calculateFundamentalsScore(effectiveScores);
    const now = Math.floor(Date.now() / 1000);

    status.fundamentals = {
        score: fundamentalsScore,
        valid_components: COMPONENTS.filter(
            component => Number.isFinite(effectiveScores[component])
        ),
        valid_weight: COMPONENTS.reduce(
            (sum, component) =>
                sum + (
                    Number.isFinite(effectiveScores[component])
                        ? FUNDAMENTALS_WEIGHTS[component]
                        : 0
                ),
            0
        ),
        updated_at: now
    };

    const updateFields = [
        ...COMPONENTS,
        "fundamentals_score",
        "evaluation_score_status",
        "evaluation_updated_at"
    ];

    const updateValues = [
        ...COMPONENTS.map(component => effectiveScores[component]),
        fundamentalsScore,
        JSON.stringify(status),
        now,
        pid
    ];

    await query(
        `UPDATE airdrop_project_metrics
         SET ${COMPONENTS.map(field => `${field} = ?`).join(", ")},
             fundamentals_score = ?,
             evaluation_score_status = ?,
             evaluation_updated_at = ?
         WHERE project_id = ?`,
        updateValues
    );

    return {
        fundamentals_score: fundamentalsScore,
        component_scores: effectiveScores,
        evaluation_score_status: status
    };
}

// =============================================
// MANUAL SCORE API HELPERS
// =============================================

async function setManualEvaluationScore(userId, projectId, component, score) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    if (!COMPONENTS.includes(component)) {
        throw new Error("Fundamentals component không hợp lệ");
    }

    const value = Number(score);

    if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("Manual Score phải nằm trong khoảng 0–100");
    }

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const metrics = await getMetrics(uid, pid);
    if (!metrics) throw new Error("Metrics chưa tồn tại");

    const status = parseEvaluationScoreStatus(
        metrics.evaluation_score_status
    );

    status[component] = {
        ...(status[component] || {}),
        manual_override: true,
        manual_score: clampScore(value),
        source: "manual",
        updated_at: Math.floor(Date.now() / 1000)
    };

    await query(
        `UPDATE airdrop_project_metrics
         SET evaluation_score_status = ?
         WHERE project_id = ?`,
        [JSON.stringify(status), pid]
    );

    return recalculateEvaluationScores(uid, pid);
}

async function clearManualEvaluationScore(userId, projectId, component) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    if (!COMPONENTS.includes(component)) {
        throw new Error("Fundamentals component không hợp lệ");
    }

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const metrics = await getMetrics(uid, pid);
    if (!metrics) throw new Error("Metrics chưa tồn tại");

    const status = parseEvaluationScoreStatus(
        metrics.evaluation_score_status
    );

    status[component] = {
        ...(status[component] || {}),
        manual_override: false,
        manual_score: null,
        source: "auto",
        updated_at: Math.floor(Date.now() / 1000)
    };

    await query(
        `UPDATE airdrop_project_metrics
         SET evaluation_score_status = ?
         WHERE project_id = ?`,
        [JSON.stringify(status), pid]
    );

    return recalculateEvaluationScores(uid, pid);
}

// =============================================
// PROJECT OWNERSHIP
// =============================================

async function getOwnedProject(userId, projectId) {
    const rows = await query(
        `SELECT id, name, network, category
         FROM airdrop_projects
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [
            requireId(projectId, "Project ID"),
            requireId(userId, "User ID")
        ]
    );

    return rows[0] || null;
}

// =============================================
// GET METRICS
// =============================================

async function getMetrics(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const rows = await query(
        `SELECT m.project_id,
                ${RAW_COLUMNS.map(field => `m.${field}`).join(", ")},
                ${DERIVED_COLUMNS.map(field => `m.${field}`).join(", ")},
                m.metrics_field_status,
                m.evaluation_score_status,
                m.fundamentals_score,
                m.investment_score,
                m.investment_rating,
                m.investment_action,
                m.risk_score,
                m.risk_level,
                m.recommendation,
                m.evaluation_updated_at,
                m.created_at,
                m.updated_at,
                ${COMPONENTS.map(field => `m.${field}`).join(", ")}
         FROM airdrop_project_metrics m
         INNER JOIN airdrop_projects p ON p.id = m.project_id
         WHERE m.project_id = ? AND p.user_id = ?
         LIMIT 1`,
        [pid, uid]
    );

    return rows[0] || null;
}

// =============================================
// GET ALL METRICS
// =============================================

async function getAllMetrics(userId) {
    const uid = requireId(userId, "User ID");

    return query(
        `SELECT m.project_id,
                ${RAW_COLUMNS.map(field => `m.${field}`).join(", ")},
                ${DERIVED_COLUMNS.map(field => `m.${field}`).join(", ")},
                m.metrics_field_status,
                m.evaluation_score_status,
                m.fundamentals_score,
                m.investment_score,
                m.investment_rating,
                m.investment_action,
                m.risk_score,
                m.risk_level,
                m.recommendation,
                m.evaluation_updated_at,
                m.created_at,
                m.updated_at,
                ${COMPONENTS.map(field => `m.${field}`).join(", ")}
         FROM airdrop_project_metrics m
         INNER JOIN airdrop_projects p ON p.id = m.project_id
         WHERE p.user_id = ?
         ORDER BY m.updated_at DESC`,
        [uid]
    );
}

// =============================================
// RECALCULATE ALL METRICS
// =============================================

async function recalculateAllMetrics(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    await recalculateDerivedIndicators(uid, pid);
    return recalculateEvaluationScores(uid, pid);
}

// =============================================
// SAVE / UPSERT METRICS
// =============================================
// =============================================
// SAVE / UPSERT METRICS
// =============================================

async function saveMetrics(userId, projectId, data = {}, options = {}) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const current = await getMetrics(uid, pid);
    const sourceByField = options.sourceByField || {};

    let values = normalizeMetrics(data);

    values = filterIncomingValues(
        current,
        values,
        sourceByField
    );

    const fields = Object.keys(values);

    if (!fields.length) {
        return getMetrics(uid, pid);
    }

    const fieldStatus = buildFieldStatus(
        current?.metrics_field_status,
        values,
        sourceByField
    );

    const dbValues = normalizeDatabaseValues(values);

    const insertFields = [
        "project_id",
        ...fields,
        "metrics_field_status"
    ];

    const insertValues = [
        pid,
        ...fields.map(field => dbValues[field]),
        JSON.stringify(fieldStatus)
    ];

    const updateSQL = [
        ...fields.map(field => `${field} = VALUES(${field})`),
        "metrics_field_status = VALUES(metrics_field_status)",
        "updated_at = CURRENT_TIMESTAMP"
    ].join(", ");

    await query(
        `INSERT INTO airdrop_project_metrics
         (${insertFields.join(", ")})
         VALUES (${insertFields.map(() => "?").join(", ")})
         ON DUPLICATE KEY UPDATE ${updateSQL}`,
        insertValues
    );

    await recordMetricHistory(pid, values, sourceByField);
    await recalculateDerivedIndicators(uid, pid);
    await recalculateEvaluationScores(uid, pid);

    return getMetrics(uid, pid);
}

// =============================================
// UPDATE METRICS
// =============================================

async function updateMetrics(userId, projectId, data = {}, options = {}) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const current = await getMetrics(uid, pid);

    if (!current) {
        return saveMetrics(uid, pid, data, options);
    }

    const sourceByField = options.sourceByField || {};

    let values = normalizeMetrics(data);

    values = filterIncomingValues(
        current,
        values,
        sourceByField
    );

    const fields = Object.keys(values);

    if (!fields.length) {
        return getMetrics(uid, pid);
    }

    const fieldStatus = buildFieldStatus(
        current.metrics_field_status,
        values,
        sourceByField
    );

    const dbValues = normalizeDatabaseValues(values);

    await query(
        `UPDATE airdrop_project_metrics
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             metrics_field_status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ?`,
        [
            ...fields.map(field => dbValues[field]),
            JSON.stringify(fieldStatus),
            pid
        ]
    );

    await recordMetricHistory(pid, values, sourceByField);
    await recalculateDerivedIndicators(uid, pid);
    await recalculateEvaluationScores(uid, pid);

    return getMetrics(uid, pid);
}
// =============================================
// DELETE METRICS
// =============================================

async function deleteMetrics(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);
    if (!project) throw new Error("Project not found");

    const result = await query(
        `DELETE FROM airdrop_project_metrics WHERE project_id = ?`,
        [pid]
    );

    return result.affectedRows > 0;
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
    RAW_COLUMNS,
    NUMERIC_COLUMNS,
    DERIVED_COLUMNS,
    FUNDAMENTALS_WEIGHTS,
    MIN_BENCHMARK_PROJECTS,
    normalizeMetrics,
    calculateDerivedIndicators,
    recalculateDerivedIndicators,
    recalculateEvaluationScores,
    recalculateAllMetrics,
    setManualEvaluationScore,
    clearManualEvaluationScore,
    getMetrics,
    getAllMetrics,
    saveMetrics,
    updateMetrics,
    deleteMetrics
};
