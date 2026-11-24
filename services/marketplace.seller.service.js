
"use strict";

const db = require("../db");
const rbacService = require("./contributor.rbac.admin.service");
const { writeAudit } = require("./contributor.audit.service");

const SELLER_ROLE = "marketplace_seller";

function positiveId(value, error = "INVALID_USER_ID") {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }
    return id;
}

function cleanText(value, max, error, required = false) {
    const text = String(value ?? "").trim();

    if (required && !text) throw new Error(error);
    if (text.length > max) throw new Error(error);

    return text || null;
}

function validEmail(value) {
    if (!value) return null;

    const email = String(value).trim().toLowerCase();

    if (
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new Error("INVALID_CONTACT_EMAIL");
    }

    return email;
}

function auditData(actorUserId, targetUserId, action, oldData, newData, audit = {}) {
    return {
        ...audit,
        actorUserId,
        targetUserId,
        action,
        entityType: "marketplace_seller",
        entityId: String(targetUserId),
        oldData: oldData || null,
        newData: newData || null
    };
}

// ========================================
// CURRENT SELLER AGREEMENT
// ========================================

// Lấy agreement hiện hành cho frontend hiển thị
async function getCurrentAgreement() {
    const [rows] = await db.execute(
        `SELECT id, version, title, content, effective_at
         FROM marketplace_agreements
         WHERE status = 'active'
           AND (effective_at IS NULL OR effective_at <= NOW())
         ORDER BY effective_at DESC, id DESC
         LIMIT 1`
    );

    if (!rows.length) {
        throw new Error("MARKETPLACE_AGREEMENT_NOT_AVAILABLE");
    }

    return rows[0];
}

// Lấy và khóa agreement trong transaction
async function getCurrentAgreementForUpdate(conn) {
    const [rows] = await conn.execute(
        `SELECT id, version, title, content, effective_at
         FROM marketplace_agreements
         WHERE status = 'active'
           AND (effective_at IS NULL OR effective_at <= NOW())
         ORDER BY effective_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`
    );

    if (!rows.length) {
        throw new Error("MARKETPLACE_AGREEMENT_NOT_AVAILABLE");
    }

    return rows[0];
}

async function hasAcceptedAgreement(conn, sellerId, agreementId) {
    const [rows] = await conn.execute(
        `SELECT id
         FROM marketplace_seller_agreements
         WHERE seller_id = ?
           AND agreement_id = ?
         LIMIT 1`,
        [sellerId, agreementId]
    );

    return rows.length > 0;
}

// ========================================
// SELLER REGISTRATION
// ========================================

async function registerSeller(userId, data = {}, audit = {}) {
    const uid = positiveId(userId);

    if (data.acceptedTerms !== true) {
        throw new Error("SELLER_AGREEMENT_REQUIRED");
    }

    const agreementId = positiveId(
        data.agreementId,
        "INVALID_AGREEMENT_ID"
    );

    const displayName = cleanText(
        data.displayName,
        150,
        "INVALID_DISPLAY_NAME",
        true
    );

    const introduction = cleanText(
        data.introduction,
        10000,
        "INVALID_INTRODUCTION"
    );

    const contactEmail = validEmail(data.contactEmail);

    const contactPhone = cleanText(
        data.contactPhone,
        30,
        "INVALID_CONTACT_PHONE"
    );

    const supportInfo = cleanText(
        data.supportInfo,
        10000,
        "INVALID_SUPPORT_INFO"
    );

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [users] = await conn.execute(
            `SELECT id
             FROM users
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [uid]
        );

        if (!users.length) {
            throw new Error("TARGET_USER_NOT_FOUND");
        }

        const [existing] = await conn.execute(
            `SELECT id, status
             FROM marketplace_sellers
             WHERE user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [uid]
        );

        if (existing.length) {
            throw new Error("SELLER_ALREADY_EXISTS");
        }

        // Kiểm tra agreement người dùng đã xem có còn hiện hành không
        const agreement = await getCurrentAgreementForUpdate(conn);

        if (Number(agreement.id) !== agreementId) {
            throw new Error("SELLER_AGREEMENT_CHANGED");
        }

        const [result] = await conn.execute(
            `INSERT INTO marketplace_sellers (
                user_id,
                display_name,
                introduction,
                contact_email,
                contact_phone,
                support_info,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [
                uid,
                displayName,
                introduction,
                contactEmail,
                contactPhone,
                supportInfo
            ]
        );

        const sellerId = result.insertId;

        // Ghi nhận phiên bản agreement mà Seller đã chấp nhận
        await conn.execute(
            `INSERT INTO marketplace_seller_agreements (
                seller_id,
                agreement_id,
                accepted_by_user_id,
                accepted_at,
                ip_address,
                user_agent
            ) VALUES (?, ?, ?, NOW(), ?, ?)`,
            [
                sellerId,
                agreement.id,
                uid,
                audit.ipAddress || null,
                audit.userAgent || null
            ]
        );

        await writeAudit(
            conn,
            auditData(
                uid,
                uid,
                "marketplace.seller.registered",
                null,
                {
                    sellerId,
                    displayName,
                    status: "pending",
                    agreementId: agreement.id,
                    agreementVersion: agreement.version
                },
                audit
            )
        );

        await conn.commit();

        return {
            sellerId,
            status: "pending",
            agreement: {
                id: agreement.id,
                version: agreement.version,
                title: agreement.title
            }
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// ========================================
// ACCEPT CURRENT AGREEMENT
// ========================================

async function acceptCurrentAgreement(userId, audit = {}) {
    const uid = positiveId(userId);
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [sellers] = await conn.execute(
            `SELECT id, status
             FROM marketplace_sellers
             WHERE user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [uid]
        );

        if (!sellers.length) {
            throw new Error("SELLER_NOT_FOUND");
        }

        const seller = sellers[0];

        if (!["pending", "active", "suspended"].includes(seller.status)) {
            throw new Error("SELLER_CANNOT_ACCEPT_AGREEMENT");
        }

        const agreement = await getCurrentAgreementForUpdate(conn);

        const accepted = await hasAcceptedAgreement(
            conn,
            seller.id,
            agreement.id
        );

        if (!accepted) {
            await conn.execute(
                `INSERT INTO marketplace_seller_agreements (
                    seller_id,
                    agreement_id,
                    accepted_by_user_id,
                    accepted_at,
                    ip_address,
                    user_agent
                ) VALUES (?, ?, ?, NOW(), ?, ?)`,
                [
                    seller.id,
                    agreement.id,
                    uid,
                    audit.ipAddress || null,
                    audit.userAgent || null
                ]
            );

            await writeAudit(
                conn,
                auditData(
                    uid,
                    uid,
                    "marketplace.seller.agreement_accepted",
                    null,
                    {
                        sellerId: seller.id,
                        agreementId: agreement.id,
                        agreementVersion: agreement.version
                    },
                    audit
                )
            );
        }

        await conn.commit();

        return {
            accepted: !accepted,
            alreadyAccepted: accepted,
            agreement: {
                id: agreement.id,
                version: agreement.version,
                title: agreement.title
            }
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// ========================================
// SELLER PROFILE
// ========================================

async function getMySellerProfile(userId) {
    const uid = positiveId(userId);

    const [rows] = await db.execute(
        `SELECT
            s.*,
            (
                SELECT a.version
                FROM marketplace_seller_agreements sa
                INNER JOIN marketplace_agreements a
                    ON a.id = sa.agreement_id
                WHERE sa.seller_id = s.id
                ORDER BY sa.accepted_at DESC, sa.id DESC
                LIMIT 1
            ) AS accepted_agreement_version
         FROM marketplace_sellers s
         WHERE s.user_id = ?
         LIMIT 1`,
        [uid]
    );

    if (!rows.length) return null;

    return rows[0];
}

async function getSellerDetail(sellerId) {
    const id = positiveId(sellerId, "INVALID_SELLER_ID");

    const [rows] = await db.execute(
        `SELECT
            s.*,
            u.email AS user_email
         FROM marketplace_sellers s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) {
        throw new Error("SELLER_NOT_FOUND");
    }

    const [agreements] = await db.execute(
        `SELECT
            sa.id,
            sa.agreement_id,
            sa.accepted_by_user_id,
            sa.accepted_at,
            sa.ip_address,
            sa.user_agent,
            a.version,
            a.title
         FROM marketplace_seller_agreements sa
         INNER JOIN marketplace_agreements a
            ON a.id = sa.agreement_id
         WHERE sa.seller_id = ?
         ORDER BY sa.accepted_at DESC, sa.id DESC`,
        [id]
    );

    return {
        seller: rows[0],
        agreements
    };
}

// ========================================
// ADMIN: SELLER APPLICATIONS
// ========================================

async function getSellerApplications(params = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const offset = (page - 1) * limit;

    const allowedStatuses = [
        "pending",
        "active",
        "rejected",
        "suspended",
        "closed"
    ];

    const status = allowedStatuses.includes(params.status)
        ? params.status
        : null;

    const search = String(params.search || "").trim().slice(0, 255);

    const conditions = [];
    const values = [];

    if (status) {
        conditions.push("s.status = ?");
        values.push(status);
    }

    if (search) {
        conditions.push(
            "(s.display_name LIKE ? OR s.contact_email LIKE ? OR u.email LIKE ?)"
        );
        values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM marketplace_sellers s
         INNER JOIN users u ON u.id = s.user_id
         ${where}`,
        values
    );

    const [rows] = await db.execute(
        `SELECT
            s.id,
            s.user_id,
            u.email AS user_email,
            s.display_name,
            s.contact_email,
            s.contact_phone,
            s.status,
            s.reviewed_by,
            s.reviewed_at,
            s.review_note,
            s.created_at,
            s.updated_at
         FROM marketplace_sellers s
         INNER JOIN users u ON u.id = s.user_id
         ${where}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    return {
        sellers: rows,
        pagination: {
            page,
            limit,
            total: Number(count.total),
            totalPages: Math.ceil(Number(count.total) / limit)
        }
    };
}

// ========================================
// ADMIN: ACTIVATE SELLER
// ========================================

async function activateSeller(sellerId, actorUserId, note = null, audit = {}) {
    const id = positiveId(sellerId, "INVALID_SELLER_ID");
    const actorId = positiveId(actorUserId);

    const reviewNote = cleanText(
        note,
        10000,
        "INVALID_REVIEW_NOTE"
    );

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Lấy user_id của Seller
        const [sellerRefs] = await conn.execute(
            `SELECT user_id
             FROM marketplace_sellers
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (!sellerRefs.length) {
            throw new Error("SELLER_NOT_FOUND");
        }

        const targetUserId = sellerRefs[0].user_id;

        // 2. Khóa User trước
        const [users] = await conn.execute(
            `SELECT id
             FROM users
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [targetUserId]
        );

        if (!users.length) {
            throw new Error("TARGET_USER_NOT_FOUND");
        }

        // 3. Khóa Seller
        const [rows] = await conn.execute(
            `SELECT *
             FROM marketplace_sellers
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (!rows.length) {
            throw new Error("SELLER_NOT_FOUND");
        }

        const seller = rows[0];

        if (Number(seller.user_id) !== Number(targetUserId)) {
            throw new Error("SELLER_USER_MISMATCH");
        }

        if (!["pending", "suspended"].includes(seller.status)) {
            throw new Error("SELLER_STATUS_INVALID");
        }

        // 4. Kiểm tra Seller đã chấp nhận agreement hiện hành
        const agreement = await getCurrentAgreementForUpdate(conn);

        const accepted = await hasAcceptedAgreement(
            conn,
            seller.id,
            agreement.id
        );

        if (!accepted) {
            throw new Error("SELLER_CURRENT_AGREEMENT_NOT_ACCEPTED");
        }

        // 5. Gán Seller role trong cùng transaction
        await rbacService.assignRoleWithConnection(
            conn,
            actorId,
            seller.user_id,
            SELLER_ROLE,
            audit
        );

        // 6. Kích hoạt Seller
        await conn.execute(
            `UPDATE marketplace_sellers
             SET status = 'active',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 review_note = ?
             WHERE id = ?`,
            [actorId, reviewNote, id]
        );

        // 7. Ghi audit
        await writeAudit(
            conn,
            auditData(
                actorId,
                seller.user_id,
                "marketplace.seller.activated",
                {
                    status: seller.status,
                    reviewNote: seller.review_note
                },
                {
                    status: "active",
                    reviewNote,
                    agreementId: agreement.id,
                    agreementVersion: agreement.version
                },
                audit
            )
        );

        await conn.commit();

        return {
            sellerId: id,
            userId: seller.user_id,
            status: "active"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// ========================================
// ADMIN: REJECT SELLER
// ========================================

async function rejectSeller(sellerId, actorUserId, reason, audit = {}) {
    return changeSellerStatus(
        sellerId,
        actorUserId,
        "pending",
        "rejected",
        "marketplace.seller.rejected",
        reason,
        audit
    );
}

// ========================================
// ADMIN: SUSPEND SELLER
// ========================================

async function suspendSeller(sellerId, actorUserId, reason, audit = {}) {
    return changeSellerStatus(
        sellerId,
        actorUserId,
        "active",
        "suspended",
        "marketplace.seller.suspended",
        reason,
        audit
    );
}

// ========================================
// ADMIN: CLOSE SELLER
// ========================================

async function closeSeller(sellerId, actorUserId, reason, audit = {}) {
    const id = positiveId(sellerId, "INVALID_SELLER_ID");
    const actorId = positiveId(actorUserId);

    const reviewNote = cleanText(
        reason,
        10000,
        "INVALID_REVIEW_NOTE",
        true
    );

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT *
             FROM marketplace_sellers
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (!rows.length) {
            throw new Error("SELLER_NOT_FOUND");
        }

        const seller = rows[0];

        if (seller.status === "closed") {
            throw new Error("SELLER_ALREADY_CLOSED");
        }

        await conn.execute(
            `UPDATE marketplace_sellers
             SET status = 'closed',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 review_note = ?
             WHERE id = ?`,
            [actorId, reviewNote, id]
        );

        await writeAudit(
            conn,
            auditData(
                actorId,
                seller.user_id,
                "marketplace.seller.closed",
                {
                    status: seller.status,
                    reviewNote: seller.review_note
                },
                {
                    status: "closed",
                    reviewNote
                },
                audit
            )
        );

        await conn.commit();

        return {
            sellerId: id,
            status: "closed"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// ========================================
// SHARED STATUS TRANSITION
// ========================================

async function changeSellerStatus(
    sellerId,
    actorUserId,
    expectedStatus,
    newStatus,
    action,
    reason,
    audit = {}
) {
    const id = positiveId(sellerId, "INVALID_SELLER_ID");
    const actorId = positiveId(actorUserId);

    const reviewNote = cleanText(
        reason,
        10000,
        "INVALID_REVIEW_NOTE",
        true
    );

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            `SELECT *
             FROM marketplace_sellers
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (!rows.length) {
            throw new Error("SELLER_NOT_FOUND");
        }

        const seller = rows[0];

        if (seller.status !== expectedStatus) {
            throw new Error("SELLER_STATUS_INVALID");
        }

        await conn.execute(
            `UPDATE marketplace_sellers
             SET status = ?,
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 review_note = ?
             WHERE id = ?`,
            [newStatus, actorId, reviewNote, id]
        );

        await writeAudit(
            conn,
            auditData(
                actorId,
                seller.user_id,
                action,
                {
                    status: seller.status,
                    reviewNote: seller.review_note
                },
                {
                    status: newStatus,
                    reviewNote
                },
                audit
            )
        );

        await conn.commit();

        return {
            sellerId: id,
            status: newStatus
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getCurrentAgreement,
    registerSeller,
    acceptCurrentAgreement,
    getMySellerProfile,
    getSellerDetail,
    getSellerApplications,
    activateSeller,
    rejectSeller,
    suspendSeller,
    closeSeller
};
