
"use strict";

const db = require("../db");

function validPage(value, fallback, max) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) return fallback;
    return Math.min(number, max);
}

function validSearch(value) {
    return typeof value === "string"
        ? value.trim().slice(0, 255)
        : "";
}

function validDate(value) {
    if (typeof value !== "string" || !value.trim()) return "";

    const date = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

async function getAuditLogs(query = {}) {
    const page = validPage(query.page, 1, 1000000);
    const limit = validPage(query.limit, 20, 100);
    const offset = (page - 1) * limit;

    const search = validSearch(query.search);
    const action = validSearch(query.action);
    const entityType = validSearch(query.entity_type);
    const dateFrom = validDate(query.date_from);
    const dateTo = validDate(query.date_to);

    if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new Error("INVALID_DATE_RANGE");
    }

    const conditions = [];
    const params = [];

    if (search) {
        if (/^#?\d+$/.test(search)) {
            const id = Number(search.replace("#", ""));

            conditions.push(`(
                id = ?
                OR actor_user_id = ?
                OR target_user_id = ?
                OR entity_id = ?
                OR action LIKE ?
                OR entity_type LIKE ?
            )`);

            params.push(
                id,
                id,
                id,
                search.replace("#", ""),
                `%${search}%`,
                `%${search}%`
            );
        } else {
            conditions.push(`(
                action LIKE ?
                OR entity_type LIKE ?
                OR entity_id LIKE ?
                OR ip_address LIKE ?
                OR user_agent LIKE ?
            )`);

            params.push(
                `%${search}%`,
                `%${search}%`,
                `%${search}%`,
                `%${search}%`,
                `%${search}%`
            );
        }
    }

    if (action) {
        conditions.push("action = ?");
        params.push(action);
    }

    if (entityType) {
        conditions.push("entity_type = ?");
        params.push(entityType);
    }

    if (dateFrom) {
        conditions.push("created_at >= ?");
        params.push(`${dateFrom} 00:00:00`);
    }

    if (dateTo) {
        conditions.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
        params.push(dateTo);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM contributor_audit_logs
         ${where}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            id,
            actor_user_id,
            target_user_id,
            action,
            entity_type,
            entity_id,
            old_data,
            new_data,
            ip_address,
            user_agent,
            created_at
         FROM contributor_audit_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const total = Number(countRows[0].total || 0);

    return {
        logs: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

module.exports = {
    getAuditLogs
};
