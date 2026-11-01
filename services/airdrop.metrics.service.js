
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

// =============================================
// RAW METRICS WHITELIST
// =============================================

const RAW_COLUMNS = [
    "token_symbol",
    "current_price",
    "total_supply",
    "circulating_supply",
    "max_supply",
    "market_cap",
    "fdv",
    "volume_24h",
    "liquidity",
    "price_change_24h",
    "tvl",
    "tvl_growth_7d",
    "tvl_growth_30d",
    "protocol_fee",
    "protocol_revenue",
    "revenue_growth_30d",
    "treasury",
    "cash_runway_months",
    "stablecoin_reserve",
    "token_buyback",
    "token_burn",
    "holders",
    "transactions_24h",
    "seed_price",
    "private_price",
    "public_price",
    "ath_price",
    "atl_price",
    "funding_amount",
    "github_stars",
    "github_forks",
    "github_watchers",
    "github_contributors",
    "github_recent_commits",
    "github_releases",
    "followers",
    "total_experience",
    "big_companies",
    "education_count"
];

const NUMERIC_COLUMNS = RAW_COLUMNS.filter(
    field => field !== "token_symbol"
);
const DERIVED_COLUMNS = [
    "circulating_percent",
    "locked_percent",
    "inflation",
    "seed_roi",
    "private_roi",
    "public_roi",
    "fair_buy_price",
    "fair_sell_price"
];
// Các cột NOT NULL trong database.
// Khi xóa dữ liệu, lưu 0 nhưng đánh dấu available = false.
const NOT_NULL_RAW_COLUMNS = new Set([
    "tvl",
    "tvl_growth_7d",
    "tvl_growth_30d",
    "protocol_fee",
    "protocol_revenue",
    "revenue_growth_30d",
    "treasury",
    "cash_runway_months",
    "stablecoin_reserve",
    "token_buyback",
    "token_burn",
    "holders",
    "transactions_24h",
    "github_stars",
    "github_forks",
    "github_watchers",
    "github_contributors",
    "github_recent_commits",
    "github_releases",
    "followers",
    "total_experience",
    "big_companies",
    "education_count"
]);

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
// FIELD STATUS
// =============================================

function parseFieldStatus(value) {
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
// DERIVED INDICATORS ENGINE
// =============================================

function isMetricAvailable(metrics, field) {
    const status = parseFieldStatus(metrics?.metrics_field_status);
    return status[field]?.available === true;
}

function getValidMetric(metrics, field) {
    if (!isMetricAvailable(metrics, field)) return null;

    const value = Number(metrics[field]);

    return Number.isFinite(value) ? value : null;
}

function calculateRatio(numerator, denominator) {
    if (numerator === null || denominator === null || denominator <= 0) {
        return null;
    }

    return Number(((numerator / denominator) * 100).toFixed(8));
}

function calculateROI(currentPrice, entryPrice) {
    if (
        currentPrice === null ||
        entryPrice === null ||
        entryPrice <= 0
    ) {
        return null;
    }

    return Number(((currentPrice / entryPrice - 1) * 100).toFixed(8));
}

function calculateDerivedIndicators(metrics) {
    const circulatingSupply = getValidMetric(metrics, "circulating_supply");
    const totalSupply = getValidMetric(metrics, "total_supply");
    const currentPrice = getValidMetric(metrics, "current_price");

    const seedPrice = getValidMetric(metrics, "seed_price");
    const privatePrice = getValidMetric(metrics, "private_price");
    const publicPrice = getValidMetric(metrics, "public_price");

    const circulatingPercent = calculateRatio(
        circulatingSupply,
        totalSupply
    );

    return {
        circulating_percent: circulatingPercent,

        locked_percent: circulatingPercent === null
            ? null
            : Number((100 - circulatingPercent).toFixed(8)),

        seed_roi: calculateROI(currentPrice, seedPrice),
        private_roi: calculateROI(currentPrice, privatePrice),
        public_roi: calculateROI(currentPrice, publicPrice)
    };
}

async function recalculateDerivedIndicators(userId, projectId) {
    const metrics = await getMetrics(userId, projectId);

    if (!metrics) return null;

    const derived = calculateDerivedIndicators(metrics);

    const fields = Object.keys(derived);

    await query(
        `UPDATE airdrop_project_metrics
         SET ${fields.map(field => `${field} = ?`).join(", ")}
         WHERE project_id = ?`,
        [
            ...fields.map(field => derived[field]),
            projectId
        ]
    );

    return derived;
}
// =============================================
// PROJECT OWNERSHIP
// =============================================

async function getOwnedProject(userId, projectId) {
    const rows = await query(
        `SELECT id
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
                m.created_at,
                m.updated_at
         FROM airdrop_project_metrics m
         INNER JOIN airdrop_projects p
            ON p.id = m.project_id
         WHERE m.project_id = ?
           AND p.user_id = ?
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
                m.created_at,
                m.updated_at
         FROM airdrop_project_metrics m
         INNER JOIN airdrop_projects p
            ON p.id = m.project_id
         WHERE p.user_id = ?
         ORDER BY m.updated_at DESC`,
        [uid]
    );
}

// =============================================
// SAVE / UPSERT METRICS
// =============================================

async function saveMetrics(userId, projectId, data = {}, options = {}) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);

    if (!project) {
        throw new Error("Project not found");
    }

    const values = normalizeMetrics(data);
    const fields = Object.keys(values);

    if (!fields.length) {
        return getMetrics(uid, pid);
    }

    const current = await getMetrics(uid, pid);

    const fieldStatus = buildFieldStatus(
        current?.metrics_field_status,
        values,
        options.sourceByField || {}
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
         ON DUPLICATE KEY UPDATE
         ${updateSQL}`,
        insertValues
    );

    await recalculateDerivedIndicators(uid, pid);

    return getMetrics(uid, pid);
}

// =============================================
// UPDATE METRICS
// Chỉ cập nhật những trường được gửi lên.
// =============================================

async function updateMetrics(userId, projectId, data = {}, options = {}) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);

    if (!project) {
        throw new Error("Project not found");
    }

    const values = normalizeMetrics(data);
    const fields = Object.keys(values);

    if (!fields.length) {
        return getMetrics(uid, pid);
    }

    const current = await getMetrics(uid, pid);

    if (!current) {
        return saveMetrics(uid, pid, values, options);
    }

    const fieldStatus = buildFieldStatus(
        current.metrics_field_status,
        values,
        options.sourceByField || {}
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

    await recalculateDerivedIndicators(uid, pid);

    return getMetrics(uid, pid);
}

// =============================================
// DELETE METRICS
// =============================================

async function deleteMetrics(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);

    if (!project) {
        throw new Error("Project not found");
    }

    const result = await query(
        `DELETE FROM airdrop_project_metrics
         WHERE project_id = ?`,
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
    normalizeMetrics,
    calculateDerivedIndicators,
    recalculateDerivedIndicators,
    getMetrics,
    getAllMetrics,
    saveMetrics,
    updateMetrics,
    deleteMetrics
};
