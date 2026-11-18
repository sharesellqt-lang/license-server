
"use strict";

async function writeAudit(conn, data = {}) {
    if (!conn || typeof conn.execute !== "function") {
        throw new Error("INVALID_AUDIT_CONNECTION");
    }

    if (
        !data.action ||
        !data.entityType ||
        typeof data.action !== "string" ||
        typeof data.entityType !== "string"
    ) {
        throw new Error("INVALID_AUDIT_DATA");
    }

    const json = value =>
        value == null ? null : JSON.stringify(value);

    await conn.execute(
        `INSERT INTO contributor_audit_logs (
            actor_user_id,
            target_user_id,
            action,
            entity_type,
            entity_id,
            old_data,
            new_data,
            ip_address,
            user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.actorUserId ?? null,
            data.targetUserId ?? null,
            data.action,
            data.entityType,
            data.entityId == null ? null : String(data.entityId),
            json(data.oldData),
            json(data.newData),
            data.ipAddress ?? null,
            data.userAgent ?? null
        ]
    );
}

module.exports = { writeAudit };
