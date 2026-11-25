
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const SETTING_RULES = {
    default_currency: { type: "string", group: "general" },
    seller_commission_rate: { type: "decimal", group: "commission", min: 0, max: 100 },
    platform_commission_rate: { type: "decimal", group: "commission", min: 0, max: 100 },
    buyer_protection_days: { type: "integer", group: "orders", min: 1, max: 365 },
    payment_deadline_hours: { type: "integer", group: "payments", min: 1, max: 720 },
    payment_verification_mode: { type: "string", group: "payments" },
    payment_auto_cancel_enabled: { type: "boolean", group: "payments" }
};

function parseValue(value, type) {
    if (type === "integer" || type === "decimal") return Number(value);
    if (type === "boolean") return value === true || value === "true" || value === 1 || value === "1";
    if (type === "json") {
        try { return JSON.parse(value); } catch { return null; }
    }
    return String(value ?? "");
}

function validateValue(key, value) {
    const rule = SETTING_RULES[key];
    if (!rule) throw new Error("MARKETPLACE_SETTING_NOT_ALLOWED");

    if (rule.type === "boolean") {
        if (typeof value !== "boolean") throw new Error("INVALID_SETTING_VALUE");
        return value ? "true" : "false";
    }

    if (rule.type === "integer" || rule.type === "decimal") {
        const number = Number(value);
        if (!Number.isFinite(number) || number < rule.min || number > rule.max) {
            throw new Error("INVALID_SETTING_VALUE");
        }
        if (rule.type === "integer" && !Number.isInteger(number)) {
            throw new Error("INVALID_SETTING_VALUE");
        }
        return String(number);
    }

    const text = String(value ?? "").trim();

    if (key === "default_currency" && !/^[A-Z]{3}$/.test(text)) {
        throw new Error("INVALID_SETTING_VALUE");
    }

    // Chỉ hỗ trợ xác minh thủ công theo quy trình thanh toán hiện tại.
    if (key === "payment_verification_mode" && text !== "manual") {
        throw new Error("INVALID_PAYMENT_VERIFICATION_MODE");
    }

    if (!text || text.length > 100) throw new Error("INVALID_SETTING_VALUE");
    return text;
}

async function getSettings() {
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value, value_type, group_key,
                description, is_public, updated_at
         FROM marketplace_settings
         ORDER BY group_key, setting_key`
    );

    const settings = rows.map(row => ({
        key: row.setting_key,
        value: parseValue(row.setting_value, row.value_type),
        type: row.value_type,
        group: row.group_key,
        description: row.description,
        isPublic: Boolean(row.is_public),
        updatedAt: row.updated_at
    }));

    const groups = {};
    for (const setting of settings) {
        if (!groups[setting.group]) groups[setting.group] = [];
        groups[setting.group].push(setting);
    }

    return { settings, groups };
}

async function updateSettings(actorUserId, data = {}, audit = {}) {
    const actorId = Number(actorUserId);
    if (!Number.isSafeInteger(actorId) || actorId <= 0) {
        throw new Error("INVALID_ADMIN_USER_ID");
    }

    const input = data.settings;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("INVALID_SETTINGS_PAYLOAD");
    }

    const keys = Object.keys(input);
    if (!keys.length) throw new Error("EMPTY_SETTINGS_PAYLOAD");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT setting_key, setting_value, value_type, group_key
             FROM marketplace_settings
             WHERE setting_key IN (${keys.map(() => "?").join(",")})
             FOR UPDATE`,
            keys
        );

        if (rows.length !== keys.length) {
            throw new Error("MARKETPLACE_SETTING_NOT_FOUND");
        }

        const current = {};
        rows.forEach(row => { current[row.setting_key] = row; });

        for (const key of keys) {
            const rule = SETTING_RULES[key];
            if (!rule || current[key].value_type !== rule.type || current[key].group_key !== rule.group) {
                throw new Error("MARKETPLACE_SETTING_NOT_ALLOWED");
            }
        }

       const merged = {};

for (const [key, row] of Object.entries(current)) {
    merged[key] = key in input
        ? validateValue(key, input[key])
        : row.setting_value;
}

const [commissionRows] = await conn.execute(
    `SELECT setting_key, setting_value
     FROM marketplace_settings
     WHERE setting_key IN (?, ?)
     FOR UPDATE`,
    ["seller_commission_rate", "platform_commission_rate"]
);

const commission = Object.fromEntries(
    commissionRows.map(row => [row.setting_key, row.setting_value])
);

const sellerRate = Number(
    merged.seller_commission_rate ?? commission.seller_commission_rate
);

const platformRate = Number(
    merged.platform_commission_rate ?? commission.platform_commission_rate
);

if (
    !Number.isFinite(sellerRate) ||
    !Number.isFinite(platformRate) ||
    Math.abs(sellerRate + platformRate - 100) > 0.000001
) {
    throw new Error("COMMISSION_RATES_MUST_EQUAL_100");
}

        const changes = [];

        for (const key of keys) {
            const oldValue = current[key].setting_value;
            const newValue = merged[key];

            if (oldValue === newValue) continue;

            await conn.execute(
                `UPDATE marketplace_settings
                 SET setting_value = ?, updated_by_user_id = ?
                 WHERE setting_key = ?`,
                [newValue, actorId, key]
            );

            changes.push({ key, oldValue, newValue });

            await writeAudit(conn, {
                ...audit,
                actorUserId: actorId,
                targetUserId: actorId,
                action: "marketplace.settings.updated",
                entityType: "marketplace_setting",
                entityId: key,
                oldData: { value: oldValue },
                newData: { value: newValue }
            });
        }

        await conn.commit();

        return {
            updatedCount: changes.length,
            changes
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getSettings,
    updateSettings
};
