
// =============================================
// services/airdrop.project.service.js
// =============================================

"use strict";
const db = require("../db");

// Hỗ trợ mysql2 pool và mysql2 promise pool.
const connection = typeof db.promise === "function" ? db.promise() : db;

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 ? result[0] : result;
}

function insertId(result) {
    return Number(result?.insertId || 0);
}

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanString(value, max = 500) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function requireId(value, label = "ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`${label} không hợp lệ`);
    }
    return id;
}

async function getOwnedProject(userId, projectId) {
    const rows = await query(
        `SELECT id, user_id, name, url, wallet, network, category,
                contract_address, start_date, end_date,
                tasks, interactions, status, result, fees,
                source, difficulty, expected_reward, notes,
                tags, watchlist, coingecko_id,
                created_at, updated_at
         FROM airdrop_projects
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [requireId(projectId, "Project ID"), requireId(userId, "User ID")]
    );

    return rows[0] || null;
}

async function getOwnedWallet(userId, walletId) {
    const rows = await query(
        `SELECT *
         FROM airdrop_wallets
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [requireId(walletId, "Wallet ID"), requireId(userId, "User ID")]
    );

    return rows[0] || null;
}

async function getOwnedParticipation(userId, participationId) {
    const rows = await query(
        `SELECT *
         FROM airdrop_project_participations
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [requireId(participationId, "Participation ID"), requireId(userId, "User ID")]
    );

    return rows[0] || null;
}

// =============================================
// PROJECT
// =============================================

const PROJECT_FIELDS = [
    "name", "url", "wallet", "network", "category", "contract_address",
    "start_date", "end_date", "tasks", "interactions",
    "status", "result", "fees", "source", "difficulty",
    "expected_reward", "notes", "tags", "watchlist",
    "coingecko_id"
];


async function getProjects(userId, filters = {}) {
    const params = [requireId(userId, "User ID")];
    let where = "WHERE p.user_id = ?";

    if (filters.status && ["on", "off"].includes(filters.status)) {
        where += " AND p.status = ?";
        params.push(filters.status);
    }

    if (filters.result && ["pending", "eligible", "not-eligible"].includes(filters.result)) {
        where += " AND p.result = ?";
        params.push(filters.result);
    }

    if (filters.search) {
        where += ` AND (
            p.name LIKE ?
            OR p.network LIKE ?
            OR p.category LIKE ?
            OR p.contract_address LIKE ?
        )`;

        const keyword = `%${String(filters.search).trim()}%`;
        params.push(keyword, keyword, keyword, keyword);
    }

    const limit = Math.min(Math.max(toNumber(filters.limit, 100), 1), 500);
    const offset = Math.max(toNumber(filters.offset, 0), 0);

    const sql = `
        SELECT
            p.id,
            p.name,
            p.url,
            p.wallet,
            p.network,
            p.wallet,
            p.network,
            p.category,
            p.contract_address,
            p.start_date,
            p.end_date,
            p.tasks,
            p.interactions,
            p.status,
            p.result,
            p.fees,
            p.source,
            p.created_at,
            p.updated_at,
            p.risk,
            p.difficulty,
            p.expected_reward,
            p.notes,
            p.tags,
            p.watchlist,
            p.coingecko_id,
            (
                SELECT COUNT(*)
                FROM airdrop_project_participations pp
                WHERE pp.project_id = p.id
                  AND pp.user_id = p.user_id
            ) AS wallet_count
        FROM airdrop_projects p
        ${where}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    return query(sql, params);
}

async function getProject(userId, projectId) {
    return getOwnedProject(userId, projectId);
}

function normalizeProjectDate(value) {
    if (!value) return null;

    const date = String(value).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Invalid project date format. Expected YYYY-MM-DD");
    }

    const [year, month, day] = date.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));

    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
    ) {
        throw new Error("Invalid project date");
    }

    return date;
}
async function createProject(userId, data = {}) {
    const uid = requireId(userId, "User ID");
    const name = cleanString(data.name, 255);

    if (!name) throw new Error("Project name is required");

    const values = {
        name,
        url: cleanString(data.url, 1000),
        wallet: cleanString(data.wallet, 128),
        network: cleanString(data.network, 80),
        category: cleanString(data.category, 100),
        contract_address: cleanString(data.contract_address, 255),
        start_date: normalizeProjectDate(data.start_date),
        end_date: normalizeProjectDate(data.end_date),
        tasks: data.tasks ?? null,
        interactions: data.interactions ?? null,
        status: ["on", "off"].includes(data.status) ? data.status : "on",
        result: ["pending", "eligible", "not-eligible"].includes(data.result) ? data.result : "pending",
        fees: Math.max(toNumber(data.fees), 0),
        source: cleanString(data.source, 255),
        difficulty: ["easy", "medium", "hard"].includes(data.difficulty) ? data.difficulty : null,
        expected_reward: cleanString(data.expected_reward, 255),
        notes: data.notes ?? null,
        tags: data.tags ?? null,
        watchlist: data.watchlist ? 1 : 0,
        coingecko_id: cleanString(data.coingecko_id, 120)
    };

    if (values.start_date && values.end_date &&
    values.end_date < values.start_date) {
        throw new Error("End date must not be earlier than start date");
    }

    const fields = ["user_id", ...PROJECT_FIELDS];
    const params = [uid, ...PROJECT_FIELDS.map(field => values[field])];

    const result = await query(
        `INSERT INTO airdrop_projects
         (${fields.join(", ")})
         VALUES (${fields.map(() => "?").join(", ")})`,
        params
    );

    return getOwnedProject(uid, insertId(result));
}

async function updateProject(userId, projectId, data = {}) {
    const uid = requireId(userId, "User ID");
    const id = requireId(projectId, "Project ID");
    const current = await getOwnedProject(uid, id);

    if (!current) return null;

    const fields = PROJECT_FIELDS.filter(field =>
        Object.prototype.hasOwnProperty.call(data, field)
    );

    if (!fields.length) return current;

    const values = fields.map(field => {
        const value = data[field];

        if (field === "name") {
            const name = cleanString(value, 255);
            if (!name) throw new Error("Project name is required");
            return name;
        }

        if (field === "status") {
            if (!["on", "off"].includes(value)) throw new Error("Invalid project status");
            return value;
        }

        if (field === "result") {
            if (!["pending", "eligible", "not-eligible"].includes(value)) {
                throw new Error("Invalid project result");
            }
            return value;
        }

        if (field === "difficulty") {
            if (value && !["easy", "medium", "hard"].includes(value)) {
                throw new Error("Invalid project difficulty");
            }
            return value || null;
        }
        if (field === "start_date" || field === "end_date") {
            return normalizeProjectDate(value);
        }
        if (field === "watchlist") return value ? 1 : 0;
        if (field === "fees") return Math.max(toNumber(value), 0);

        return value;
    });

    const next = { ...current, ...Object.fromEntries(fields.map((field, i) => [field, values[i]])) };

    if (field === "category") {
        return cleanString(value, 100);
    }

    if (next.start_date && next.end_date &&
        next.end_date < next.start_date) {
        throw new Error("End date must not be earlier than start date");
    }

    await query(
        `UPDATE airdrop_projects
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [...values, id, uid]
    );

    return getOwnedProject(uid, id);
}

async function deleteProject(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const id = requireId(projectId, "Project ID");

    // Không xóa dữ liệu theo dõi. Tắt project để tránh mất lịch sử.
    const result = await query(
        `UPDATE airdrop_projects
         SET status = 'off', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [id, uid]
    );

    return result.affectedRows > 0;
}

// =============================================
// WALLET
// =============================================

async function getWallets(userId, filters = {}) {
    const params = [requireId(userId, "User ID")];
    let where = "WHERE user_id = ?";

    if (filters.network) {
        where += " AND network = ?";
        params.push(cleanString(filters.network, 80));
    }

    if (filters.active !== undefined) {
        where += " AND is_active = ?";
        params.push(filters.active ? 1 : 0);
    }

    return query(
        `SELECT *
         FROM airdrop_wallets
         ${where}
         ORDER BY updated_at DESC`,
        params
    );
}

async function createWallet(userId, data = {}) {
    const uid = requireId(userId, "User ID");
    const walletName = cleanString(data.wallet_name, 120);
    const address = cleanString(data.wallet_address, 128);
    const network = cleanString(data.network, 80);

    if (!walletName) throw new Error("Wallet name is required");
    if (!address) throw new Error("Wallet address is required");
    if (!network) throw new Error("Wallet network is required");

    const result = await query(
        `INSERT INTO airdrop_wallets
         (user_id, wallet_name, wallet_address, network, wallet_type, note, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            uid, walletName, address, network,
            cleanString(data.wallet_type, 40),
            cleanString(data.note, 500),
            data.is_active === false ? 0 : 1
        ]
    );

    return getOwnedWallet(uid, insertId(result));
}

async function updateWallet(userId, walletId, data = {}) {
    const uid = requireId(userId, "User ID");
    const id = requireId(walletId, "Wallet ID");
    const wallet = await getOwnedWallet(uid, id);

    if (!wallet) return null;

    const allowed = ["wallet_name", "wallet_address", "network", "wallet_type", "note", "is_active"];
    const fields = allowed.filter(field => Object.prototype.hasOwnProperty.call(data, field));

    if (!fields.length) return wallet;

    const values = fields.map(field => {
        if (field === "wallet_name") {
            const value = cleanString(data[field], 120);
            if (!value) throw new Error("Wallet name is required");
            return value;
        }

        if (field === "wallet_address") {
            const value = cleanString(data[field], 128);
            if (!value) throw new Error("Wallet address is required");
            return value;
        }

        if (field === "network") {
            const value = cleanString(data[field], 80);
            if (!value) throw new Error("Wallet network is required");
            return value;
        }

        if (field === "is_active") return data[field] ? 1 : 0;
        return cleanString(data[field], field === "note" ? 500 : 40);
    });

    await query(
        `UPDATE airdrop_wallets
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [...values, id, uid]
    );

    return getOwnedWallet(uid, id);
}

// =============================================
// PARTICIPATION
// =============================================

async function getParticipations(userId, filters = {}) {
    const uid = requireId(userId, "User ID");
    const params = [uid];
    let where = "WHERE pp.user_id = ?";

    if (filters.project_id) {
        where += " AND pp.project_id = ?";
        params.push(requireId(filters.project_id, "Project ID"));
    }

    if (filters.wallet_id) {
        where += " AND pp.wallet_id = ?";
        params.push(requireId(filters.wallet_id, "Wallet ID"));
    }

    if (filters.result_status) {
        where += " AND pp.result_status = ?";
        params.push(cleanString(filters.result_status, 30));
    }

    if (filters.claim_status) {
        where += " AND pp.claim_status = ?";
        params.push(cleanString(filters.claim_status, 30));
    }

    return query(
        `SELECT pp.*,
                p.name AS project_name,
                p.url AS project_url,
                p.network AS project_network,
                w.wallet_name,
                w.wallet_address,
                w.network AS wallet_network
         FROM airdrop_project_participations pp
         INNER JOIN airdrop_projects p
            ON p.id = pp.project_id AND p.user_id = pp.user_id
         INNER JOIN airdrop_wallets w
            ON w.id = pp.wallet_id AND w.user_id = pp.user_id
         ${where}
         ORDER BY COALESCE(pp.last_activity_at, pp.started_at, pp.created_at) DESC`,
        params
    );
}

async function createParticipation(userId, data = {}) {
    const uid = requireId(userId, "User ID");
    const projectId = requireId(data.project_id, "Project ID");
    const walletId = requireId(data.wallet_id, "Wallet ID");

    const project = await getOwnedProject(uid, projectId);
    if (!project) throw new Error("Project not found");

    const wallet = await getOwnedWallet(uid, walletId);
    if (!wallet) throw new Error("Wallet not found");

    const result = await query(
        `INSERT INTO airdrop_project_participations
         (user_id, project_id, wallet_id, participation_status,
          eligibility_status, result_status, claim_status,
          started_at, last_activity_at, total_fees, fee_currency, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP),
                 CURRENT_TIMESTAMP, ?, ?, ?)`,
        [
            uid, projectId, walletId,
            cleanString(data.participation_status, 30) || "participating",
            cleanString(data.eligibility_status, 30) || "unknown",
            cleanString(data.result_status, 30) || "unknown",
            cleanString(data.claim_status, 30) || "not_available",
            data.started_at || null,
            Math.max(toNumber(data.total_fees), 0),
            cleanString(data.fee_currency, 30),
            data.note ?? null
        ]
    );

    const participationId = insertId(result);

    await addParticipationHistory(uid, participationId, {
        event_type: "participation_created",
        details: "Wallet linked to project"
    });

    return getOwnedParticipation(uid, participationId);
}

const PARTICIPATION_FIELDS = [
    "participation_status", "eligibility_status", "result_status",
    "claim_status", "started_at", "last_activity_at",
    "snapshot_at", "result_announced_at", "claim_started_at",
    "claim_deadline_at", "total_fees", "fee_currency", "note"
];

async function updateParticipation(userId, participationId, data = {}) {
    const uid = requireId(userId, "User ID");
    const id = requireId(participationId, "Participation ID");
    const current = await getOwnedParticipation(uid, id);

    if (!current) return null;

    const fields = PARTICIPATION_FIELDS.filter(field =>
        Object.prototype.hasOwnProperty.call(data, field)
    );

    if (!fields.length) return current;

    const values = fields.map(field =>
        field === "total_fees"
            ? Math.max(toNumber(data[field]), 0)
            : field === "note"
                ? data[field]
                : field.endsWith("_at")
                    ? (data[field] || null)
                    : cleanString(data[field], 30)
    );

    await query(
        `UPDATE airdrop_project_participations
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             last_activity_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [...values, id, uid]
    );

    for (let i = 0; i < fields.length; i++) {
        if (String(current[fields[i]] ?? "") !== String(values[i] ?? "")) {
            await addParticipationHistory(uid, id, {
                event_type: "status_updated",
                old_value: `${fields[i]}: ${current[fields[i]] ?? ""}`,
                new_value: `${fields[i]}: ${values[i] ?? ""}`,
                details: `Updated ${fields[i]}`
            });
        }
    }

    return getOwnedParticipation(uid, id);
}

// =============================================
// PARTICIPATION HISTORY
// =============================================

async function addParticipationHistory(userId, participationId, data = {}) {
    const uid = requireId(userId, "User ID");
    const id = requireId(participationId, "Participation ID");
    const participation = await getOwnedParticipation(uid, id);

    if (!participation) throw new Error("Participation not found");

    const result = await query(
        `INSERT INTO airdrop_participation_history
         (user_id, participation_id, event_type, event_at,
          old_value, new_value, transaction_hash, details)
         VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)`,
        [
            uid, id,
            cleanString(data.event_type, 50) || "activity",
            data.event_at || null,
            data.old_value ?? null,
            data.new_value ?? null,
            cleanString(data.transaction_hash, 255),
            cleanString(data.details, 1000)
        ]
    );

    await query(
        `UPDATE airdrop_project_participations
         SET last_activity_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [id, uid]
    );

    return { id: insertId(result), participation_id: id };
}

async function getParticipationHistory(userId, participationId) {
    const uid = requireId(userId, "User ID");
    const id = requireId(participationId, "Participation ID");

    const participation = await getOwnedParticipation(uid, id);
    if (!participation) return null;

    return query(
        `SELECT *
         FROM airdrop_participation_history
         WHERE user_id = ? AND participation_id = ?
         ORDER BY event_at DESC, id DESC`,
        [uid, id]
    );
}

// =============================================
// REWARDS
// =============================================

async function getRewards(userId, participationId) {
    const uid = requireId(userId, "User ID");
    const params = [uid];
    let where = "WHERE r.user_id = ?";

    if (participationId) {
        const id = requireId(participationId, "Participation ID");
        const participation = await getOwnedParticipation(uid, id);
        if (!participation) return null;
        where += " AND r.participation_id = ?";
        params.push(id);
    }

    return query(
        `SELECT r.*
         FROM airdrop_participation_rewards r
         ${where}
         ORDER BY r.created_at DESC`,
        params
    );
}

async function createReward(userId, data = {}) {
    const uid = requireId(userId, "User ID");
    const participationId = requireId(data.participation_id, "Participation ID");

    const participation = await getOwnedParticipation(uid, participationId);
    if (!participation) throw new Error("Participation not found");

    const symbol = cleanString(data.token_symbol, 40);
    if (!symbol) throw new Error("Token symbol is required");

    const result = await query(
        `INSERT INTO airdrop_participation_rewards
         (user_id, participation_id, token_name, token_symbol,
          token_contract, network, announced_amount, claimed_amount,
          received_amount, announced_at, claimed_at, received_at,
          transaction_hash, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            uid, participationId,
            cleanString(data.token_name, 120),
            symbol,
            cleanString(data.token_contract, 128),
            cleanString(data.network, 80),
            data.announced_amount ?? null,
            data.claimed_amount ?? 0,
            data.received_amount ?? 0,
            data.announced_at || null,
            data.claimed_at || null,
            data.received_at || null,
            cleanString(data.transaction_hash, 255),
            cleanString(data.note, 500)
        ]
    );

    await addParticipationHistory(uid, participationId, {
        event_type: "reward_created",
        transaction_hash: data.transaction_hash,
        details: `Reward recorded: ${symbol}`
    });

    return { id: insertId(result), participation_id: participationId };
}

async function updateReward(userId, rewardId, data = {}) {
    const uid = requireId(userId, "User ID");
    const id = requireId(rewardId, "Reward ID");

    const rows = await query(
        `SELECT *
         FROM airdrop_participation_rewards
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [id, uid]
    );

    const reward = rows[0];
    if (!reward) return null;

    const fieldsAllowed = [
        "token_name", "token_symbol", "token_contract", "network",
        "announced_amount", "claimed_amount", "received_amount",
        "announced_at", "claimed_at", "received_at",
        "transaction_hash", "note"
    ];

    const fields = fieldsAllowed.filter(field =>
        Object.prototype.hasOwnProperty.call(data, field)
    );

    if (!fields.length) return reward;

    const values = fields.map(field => data[field]);

    await query(
        `UPDATE airdrop_participation_rewards
         SET ${fields.map(field => `${field} = ?`).join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [...values, id, uid]
    );

    await addParticipationHistory(uid, reward.participation_id, {
        event_type: "reward_updated",
        transaction_hash: data.transaction_hash,
        details: `Reward #${id} updated`
    });

    const updated = await query(
        `SELECT *
         FROM airdrop_participation_rewards
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [id, uid]
    );

    return updated[0] || null;
}

async function deleteReward(userId, rewardId) {
    const uid = requireId(userId, "User ID");
    const id = requireId(rewardId, "Reward ID");

    const rows = await query(
        `SELECT participation_id
         FROM airdrop_participation_rewards
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [id, uid]
    );

    if (!rows[0]) return false;

    await query(
        `DELETE FROM airdrop_participation_rewards
         WHERE id = ? AND user_id = ?`,
        [id, uid]
    );

    await addParticipationHistory(uid, rows[0].participation_id, {
        event_type: "reward_deleted",
        details: `Reward #${id} deleted`
    });

    return true;
}

// =============================================
// PROJECT DETAIL / TRACKING SUMMARY
// =============================================

async function getProjectTracking(userId, projectId) {
    const uid = requireId(userId, "User ID");
    const id = requireId(projectId, "Project ID");

    const project = await getOwnedProject(uid, id);
    if (!project) return null;

    const participations = await getParticipations(uid, { project_id: id });

    const rewards = await query(
        `SELECT r.*
         FROM airdrop_participation_rewards r
         INNER JOIN airdrop_project_participations pp
            ON pp.id = r.participation_id
           AND pp.user_id = r.user_id
         WHERE r.user_id = ? AND pp.project_id = ?
         ORDER BY r.created_at DESC`,
        [uid, id]
    );

    return { project, participations, rewards };
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
    // Project
    getProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,

    // Wallet
    getWallets,
    createWallet,
    updateWallet,

    // Participation
    getParticipations,
    createParticipation,
    updateParticipation,

    // History
    addParticipationHistory,
    getParticipationHistory,

    // Rewards
    getRewards,
    createReward,
    updateReward,
    deleteReward,

    // Combined
    getProjectTracking
};
