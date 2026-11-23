
"use strict";

const db = require("../db");
const auditService = require("./contributor.audit.service");

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_ID");
    return id;
}

async function getCommissionHolds(params = {}) {
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const filters = [];
    const values = [];

    if (params.status && ["active", "released"].includes(params.status)) {
        filters.push("h.status = ?");
        values.push(params.status);
    }

    if (params.hold_type) {
        filters.push("h.hold_type = ?");
        values.push(String(params.hold_type));
    }

    if (params.commission_id) {
        filters.push("h.commission_id = ?");
        values.push(validId(params.commission_id));
    }

    const where = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_commission_holds h
         ${where}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            h.*,
            c.order_id,
            c.order_item_id,
            c.seller_id,
            c.seller_user_id,
            c.status AS commission_status,
            c.commissionable_amount,
            c.seller_amount,
            c.platform_amount,
            c.eligible_at
         FROM marketplace_commission_holds h
         INNER JOIN marketplace_commissions c
            ON c.id = h.commission_id
         ${where}
         ORDER BY h.created_at DESC, h.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    const total = Number(countRows[0].total || 0);

    return {
        items: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function createAdminHold(commissionId, actorUserId, data = {}, auditInfo = {}) {
    commissionId = validId(commissionId);
    actorUserId = validId(actorUserId);

    const reason = String(data.reason || "").trim();

    if (!reason || reason.length > 5000) {
        fail("INVALID_COMMISSION_HOLD_REASON");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [commissions] = await conn.execute(
            `SELECT id, status
             FROM marketplace_commissions
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [commissionId]
        );

        if (!commissions.length) {
            fail("COMMISSION_NOT_FOUND");
        }

        const commission = commissions[0];

        if (!["pending_protection", "available", "on_hold"].includes(commission.status)) {
            fail("COMMISSION_NOT_HOLDABLE");
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_commission_holds (
                commission_id,
                hold_type,
                reference_type,
                reference_id,
                reason,
                status,
                created_by_user_id
             ) VALUES (?, 'admin', 'admin', NULL, ?, 'active', ?)`,
            [commissionId, reason, actorUserId]
        );

        if (commission.status !== "on_hold") {
            await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = 'on_hold'
                 WHERE id = ?
                   AND status IN ('pending_protection', 'available')`,
                [commissionId]
            );
        }

        await auditService.writeAudit(conn, {
            actorUserId,
            action: "marketplace.commission.hold.created",
            entityType: "marketplace_commission_hold",
            entityId: String(result.insertId),
            oldData: {
                commissionStatus: commission.status
            },
            newData: {
                commissionId,
                holdType: "admin",
                reason,
                commissionStatus: "on_hold"
            },
            ipAddress: auditInfo.ipAddress || null,
            userAgent: auditInfo.userAgent || null
        });

        await conn.commit();

        return {
            holdId: result.insertId,
            commissionId,
            commissionStatus: "on_hold"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function releaseAdminHold(holdId, actorUserId, data = {}, auditInfo = {}) {
    holdId = validId(holdId);
    actorUserId = validId(actorUserId);

    const releaseNote = String(data.releaseNote || "").trim();

    if (releaseNote.length > 5000) {
        fail("INVALID_COMMISSION_HOLD_RELEASE_NOTE");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [holds] = await conn.execute(
            `SELECT *
             FROM marketplace_commission_holds
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [holdId]
        );

        if (!holds.length) {
            fail("COMMISSION_HOLD_NOT_FOUND");
        }

        const hold = holds[0];

        if (hold.hold_type !== "admin" || hold.reference_type !== "admin") {
            fail("COMMISSION_HOLD_NOT_ADMIN_OWNED");
        }

        if (hold.status !== "active") {
            fail("COMMISSION_HOLD_ALREADY_RELEASED");
        }

        const [commissions] = await conn.execute(
            `SELECT id, status, eligible_at, order_item_id
             FROM marketplace_commissions
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [hold.commission_id]
        );

        if (!commissions.length) {
            fail("COMMISSION_NOT_FOUND");
        }

        const commission = commissions[0];

        await conn.execute(
            `UPDATE marketplace_commission_holds
             SET status = 'released',
                 released_by_user_id = ?,
                 released_at = NOW(),
                 reason = CONCAT(
                    COALESCE(reason, ''),
                    CASE WHEN ? <> '' THEN CONCAT('\nRelease note: ', ?) ELSE '' END
                 )
             WHERE id = ?
               AND status = 'active'`,
            [actorUserId, releaseNote, releaseNote, holdId]
        );

        const [activeHolds] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_commission_holds
             WHERE commission_id = ?
               AND status = 'active'`,
            [commission.id]
        );

        const [activeTickets] = await conn.execute(
            `SELECT id
             FROM marketplace_support_tickets
             WHERE order_item_id = ?
               AND status IN (
                   'open',
                   'waiting_seller',
                   'waiting_buyer',
                   'under_review'
               )
             LIMIT 1
             FOR UPDATE`,
            [commission.order_item_id]
        );

        let commissionStatus = commission.status;

        if (
            Number(activeHolds[0].total) === 0 &&
            !activeTickets.length &&
            commission.status === "on_hold"
        ) {
            await conn.execute(
                `UPDATE marketplace_commissions
                 SET status = CASE
                    WHEN eligible_at IS NOT NULL AND eligible_at <= NOW()
                        THEN 'available'
                    ELSE 'pending_protection'
                 END
                 WHERE id = ?
                   AND status = 'on_hold'`,
                [commission.id]
            );

            const [updated] = await conn.execute(
                `SELECT status
                 FROM marketplace_commissions
                 WHERE id = ?
                 LIMIT 1`,
                [commission.id]
            );

            commissionStatus = updated[0].status;
        }

        await auditService.writeAudit(conn, {
            actorUserId,
            action: "marketplace.commission.hold.released",
            entityType: "marketplace_commission_hold",
            entityId: String(holdId),
            oldData: {
                holdStatus: "active",
                commissionStatus: commission.status
            },
            newData: {
                holdStatus: "released",
                releaseNote: releaseNote || null,
                remainingActiveHolds: Number(activeHolds[0].total),
                commissionStatus
            },
            ipAddress: auditInfo.ipAddress || null,
            userAgent: auditInfo.userAgent || null
        });

        await conn.commit();

        return {
            holdId,
            commissionId: commission.id,
            holdStatus: "released",
            remainingActiveHolds: Number(activeHolds[0].total),
            commissionStatus
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getCommissionHolds,
    createAdminHold,
    releaseAdminHold
};
