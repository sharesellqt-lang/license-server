
// =============================================
// services/airdrop.metrics.service.js
// =============================================

"use strict";

const db = require("../config/db");

const connection = typeof db.promise === "function" ? db.promise() : db;

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 ? result[0] : result;
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
// Chỉ lưu dữ liệu đầu vào.
// Không thêm các trường phân tích.
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
    "forks",
    "watchers",
    "contributors",
    "recent_commits",
    "releases",
    "followers",
    "total_experience",
    "big_companies",
    "education_count"
];

const NUMERIC_COLUMNS = RAW_COLUMNS.filter(
    field => field !== "token_symbol"
);

function normalizeMetrics(data = {}) {
    const result = {};

    for (const field of RAW_COLUMNS) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) continue;

        const value = data[field];

        if (value === undefined) continue;

        if (field === "token_symbol") {
            result[field] = value === null
                ? null
                : String(value).trim().slice(0, 40);
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

async function saveMetrics(userId, projectId, data = {}) {
    const uid = requireId(userId, "User ID");
    const pid = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, pid);

    if (!project) {
        throw new Error("Project not found");
    }

    const values = normalizeMetrics(data);
    const fields = Object.keys(values);

    if (!fields.length) {
        const current = await getMetrics(uid, pid);
        return current || null;
    }

    const insertFields = ["project_id", ...fields];
    const insertValues = [pid, ...fields.map(field => values[field])];

    const updateSQL = fields.map(
        field => `${field} = VALUES(${field})`
    ).join(", ");

    await query(
        `INSERT INTO airdrop_project_metrics
         (${insertFields.join(", ")})
         VALUES (${insertFields.map(() => "?").join(", ")})
         ON DUPLICATE KEY UPDATE
         ${updateSQL},
         updated_at = CURRENT_TIMESTAMP`,
        insertValues
    );

    return getMetrics(uid, pid);
}

// =============================================
// UPDATE METRICS
// Chỉ cập nhật những trường được gửi lên.
// =============================================

async function updateMetrics(userId, projectId, data = {}) {
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
        return saveMetrics(uid, pid, values);
    }

    await query(
        `UPDATE airdrop_project_metrics
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ?`,
        [...fields.map(field => values[field]), pid]
    );

    return getMetrics(uid, pid);
}

// =============================================
// DELETE METRICS
// Chỉ xóa dữ liệu metrics của project.
// Không xóa project.
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
    normalizeMetrics,
    getMetrics,
    getAllMetrics,
    saveMetrics,
    updateMetrics,
    deleteMetrics
};
