
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

const PAYMENT_BANK_KEY = "marketplace_payment_bank_account";

const SETTING_RULES = {
    default_currency: { type: "string", group: "general" },
    seller_commission_rate: { type: "decimal", group: "commission", min: 0, max: 100 },
    platform_commission_rate: { type: "decimal", group: "commission", min: 0, max: 100 },
    buyer_protection_days: { type: "integer", group: "orders", min: 1, max: 365 },
    payment_deadline_hours: { type: "integer", group: "payments", min: 1, max: 720 },
    payment_verification_mode: { type: "string", group: "payments" },
    payment_auto_cancel_enabled: { type: "boolean", group: "payments" },
    [PAYMENT_BANK_KEY]: { type: "json", group: "payments" }
};

function parseValue(value, type) {
    if (type === "integer" || type === "decimal") return Number(value);
    if (type === "boolean") return value === true || value === "true" || value === 1 || value === "1";

    if (type === "json") {
        try {
            return typeof value === "string" ? JSON.parse(value) : value;
        } catch {
            return null;
        }
    }

    return String(value ?? "");
}

function normalizePaymentBankAccount(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    const allowedKeys = [
        "enabled",
        "bankCode",
        "bankName",
        "accountNumber",
        "accountName",
        "branch",
        "qrEnabled",
        "transferContentPrefix"
    ];

    if (Object.keys(value).some(key => !allowedKeys.includes(key))) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    const result = {
        enabled: value.enabled,
        bankCode: String(value.bankCode ?? "").trim().toUpperCase(),
        bankName: String(value.bankName ?? "").trim(),
        accountNumber: String(value.accountNumber ?? "").trim(),
        accountName: String(value.accountName ?? "").trim().toUpperCase(),
        branch: String(value.branch ?? "").trim(),
        qrEnabled: value.qrEnabled,
        transferContentPrefix: String(value.transferContentPrefix ?? "MKT").trim().toUpperCase()
    };

    if (typeof result.enabled !== "boolean" || typeof result.qrEnabled !== "boolean") {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    if (
        result.bankCode.length > 30 ||
        result.bankName.length > 100 ||
        result.accountNumber.length > 30 ||
        result.accountName.length > 150 ||
        result.branch.length > 150 ||
        result.transferContentPrefix.length > 20
    ) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    if (!/^[A-Z0-9]{2,30}$/.test(result.bankCode) && result.bankCode) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    if (result.accountNumber && !/^[0-9]{6,30}$/.test(result.accountNumber)) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    if (result.transferContentPrefix && !/^[A-Z0-9_-]{1,20}$/.test(result.transferContentPrefix)) {
        throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
    }

    if (result.enabled) {
        if (
            !result.bankCode ||
            !result.bankName ||
            !result.accountNumber ||
            !result.accountName ||
            !result.transferContentPrefix
        ) {
            throw new Error("INVALID_PAYMENT_BANK_ACCOUNT");
        }
    }

    return result;
}

function validateValue(key, value) {
    const rule = SETTING_RULES[key];
    if (!rule) throw new Error("MARKETPLACE_SETTING_NOT_ALLOWED");

    if (rule.type === "json") {
        if (key === PAYMENT_BANK_KEY) {
            return JSON.stringify(normalizePaymentBankAccount(value));
        }

        throw new Error("INVALID_SETTING_VALUE");
    }

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

// Chỉ trả về dữ liệu ngân hàng được phép công khai cho Buyer.
async function getPublicPaymentBankAccount() {
    const [rows] = await db.execute(
        `SELECT setting_value, value_type
         FROM marketplace_settings
         WHERE setting_key = ?
         LIMIT 1`,
        [PAYMENT_BANK_KEY]
    );

    if (!rows.length || rows[0].value_type !== "json") {
        return { enabled: false };
    }

    const config = normalizePaymentBankAccount(
        parseValue(rows[0].setting_value, "json")
    );

    if (!config.enabled) {
        return { enabled: false };
    }

    return {
        enabled: true,
        bankCode: config.bankCode,
        bankName: config.bankName,
        accountNumber: config.accountNumber,
        accountName: config.accountName,
        branch: config.branch,
        qrEnabled: config.qrEnabled,
        transferContentPrefix: config.transferContentPrefix
    };
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
        rows.forEach(row => {
            current[row.setting_key] = row;
        });

        for (const key of keys) {
            const rule = SETTING_RULES[key];

            if (
                !rule ||
                current[key].value_type !== rule.type ||
                current[key].group_key !== rule.group
            ) {
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
    updateSettings,
    getPublicPaymentBankAccount
};
