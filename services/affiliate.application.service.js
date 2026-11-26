
"use strict";

const db = require("../db");

const PERMISSION_KEY = "affiliate.link.create";

const APPLICATION_STATUSES = [
    "pending",
    "approved",
    "rejected",
    "withdrawn"
];

function validateUserId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("INVALID_USER_ID");
    }
    return id;
}

function requiredText(value, maxLength, error) {
    if (typeof value !== "string") throw new Error(error);

    const result = value.trim();

    if (!result || result.length > maxLength) {
        throw new Error(error);
    }

    return result;
}

function optionalText(value, maxLength, error) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value !== "string") throw new Error(error);

    const result = value.trim();

    if (!result || result.length > maxLength) {
        throw new Error(error);
    }

    return result;
}

function validateEmail(value) {
    const email = requiredText(
        value,
        255,
        "INVALID_APPLICATION_EMAIL"
    ).toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("INVALID_APPLICATION_EMAIL");
    }

    return email;
}

function validatePhone(value) {
    const phone = requiredText(
        value,
        30,
        "INVALID_APPLICATION_PHONE"
    );

    if (!/^[0-9+().\-\s]{7,30}$/.test(phone)) {
        throw new Error("INVALID_APPLICATION_PHONE");
    }

    return phone;
}

function validateChannelUrl(value) {
    const channelUrl = requiredText(
        value,
        1000,
        "INVALID_APPLICATION_CHANNEL_URL"
    );

    let parsed;

    try {
        parsed = new URL(channelUrl);
    } catch {
        throw new Error("INVALID_APPLICATION_CHANNEL_URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("INVALID_APPLICATION_CHANNEL_URL");
    }

    return channelUrl;
}

function validateAudienceSize(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const number = Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        throw new Error("INVALID_APPLICATION_AUDIENCE_SIZE");
    }

    return number;
}

function validatePagination(query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? 20 : Number(query.limit);

    if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 1000000
    ) {
        throw new Error("INVALID_PAGINATION_PAGE");
    }

    if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
    ) {
        throw new Error("INVALID_PAGINATION_LIMIT");
    }

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function auditPayload(data) {
    return JSON.stringify(data ?? {});
}

async function writeAudit(
    conn,
    {
        actorUserId,
        targetUserId,
        action,
        applicationId,
        oldData = null,
        newData = null,
        audit = {}
    }
) {
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
        ) VALUES (?, ?, ?, 'affiliate_application', ?, ?, ?, ?, ?)`,
        [
            actorUserId,
            targetUserId,
            action,
            applicationId,
            oldData === null ? null : auditPayload(oldData),
            newData === null ? null : auditPayload(newData),
            audit.ipAddress || null,
            typeof audit.userAgent === "string"
    ? audit.userAgent.slice(0, 500)
    : null
        ]
    );
}

async function withTransaction(callback) {
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const result = await callback(conn);

        await conn.commit();

        return result;
    } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            console.error(
                "[AFFILIATE APPLICATION ROLLBACK]",
                rollbackError
            );
        }

        throw error;
    } finally {
        conn.release();
    }
}

// =====================================================
// USER: CREATE APPLICATION
// =====================================================

async function createApplication(userId, input, audit = {}) {
    const id = validateUserId(userId);

    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
    ) {
        throw new Error("INVALID_APPLICATION_DATA");
    }

    const data = {
        fullName: requiredText(
            input.full_name,
            150,
            "INVALID_APPLICATION_FULL_NAME"
        ),
        phone: validatePhone(input.phone),
        email: input.email === undefined || input.email === null || input.email === ""
    ? null
    : validateEmail(input.email),
        channelType: requiredText(
            input.channel_type,
            100,
            "INVALID_APPLICATION_CHANNEL_TYPE"
        ),
        channelUrl: validateChannelUrl(input.channel_url),
        audienceSize: validateAudienceSize(input.audience_size),
        promotionMethod: requiredText(
            input.promotion_method,
            10000,
            "INVALID_APPLICATION_PROMOTION_METHOD"
        ),
        experience: optionalText(
            input.experience,
            10000,
            "INVALID_APPLICATION_EXPERIENCE"
        ),
        motivation: requiredText(
            input.motivation,
            10000,
            "INVALID_APPLICATION_MOTIVATION"
        )
    };

    return withTransaction(async conn => {
        // Serialize application submissions for the same user.
        const [users] = await conn.execute(
    `SELECT id, email
     FROM users
     WHERE id = ?
     FOR UPDATE`,
    [id]
);

if (!users.length) {
    throw new Error("USER_NOT_FOUND");
}

data.email = data.email || validateEmail(users[0].email);

        const [pendingRows] = await conn.execute(
            `SELECT id
             FROM affiliate_applications
             WHERE user_id = ?
               AND status = 'pending'
             LIMIT 1
             FOR UPDATE`,
            [id]
        );

        if (pendingRows.length) {
            throw new Error("AFFILIATE_APPLICATION_ALREADY_PENDING");
        }

        const [approvedRows] = await conn.execute(
            `SELECT id
            FROM affiliate_applications
            WHERE user_id = ?
            AND status = 'approved'
            LIMIT 1`,
            [id]
        );

        if (approvedRows.length) {
            throw new Error("AFFILIATE_APPLICATION_ALREADY_APPROVED");
        }
        const [result] = await conn.execute(
            `INSERT INTO affiliate_applications (
                user_id,
                full_name,
                phone,
                email,
                channel_type,
                channel_url,
                audience_size,
                promotion_method,
                experience,
                motivation,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                id,
                data.fullName,
                data.phone,
                data.email,
                data.channelType,
                data.channelUrl,
                data.audienceSize,
                data.promotionMethod,
                data.experience,
                data.motivation
            ]
        );

        const applicationId = result.insertId;

        await writeAudit(conn, {
            actorUserId: id,
            targetUserId: id,
            action: "affiliate_application_submitted",
            applicationId,
            newData: {
                ...data,
                status: "pending"
            },
            audit
        });

        return {
            applicationId,
            status: "pending"
        };
    });
}

// =====================================================
// USER: GET MY APPLICATIONS
// =====================================================

async function getMyApplications(userId) {
    const id = validateUserId(userId);

    const [rows] = await db.execute(
        `SELECT
            id,
            full_name,
            phone,
            email,
            channel_type,
            channel_url,
            audience_size,
            promotion_method,
            experience,
            motivation,
            status,
            reviewed_at,
            rejection_reason,
            created_at,
            updated_at
         FROM affiliate_applications
         WHERE user_id = ?
         ORDER BY id DESC`,
        [id]
    );

    return rows;
}

// =====================================================
// ADMIN: LIST APPLICATIONS
// =====================================================

async function getApplications(query = {}) {
    const { page, limit, offset } = validatePagination(query);

    const conditions = [];
    const params = [];

    if (query.status !== undefined && query.status !== "") {
        const status = String(query.status).trim().toLowerCase();

        if (!APPLICATION_STATUSES.includes(status)) {
            throw new Error("INVALID_APPLICATION_STATUS");
        }

        conditions.push("a.status = ?");
        params.push(status);
    }

    if (query.search !== undefined && query.search !== "") {
        const search = String(query.search).trim();

        if (!search || search.length > 150) {
            throw new Error("INVALID_APPLICATION_SEARCH");
        }

        conditions.push(`(
            a.full_name LIKE ?
            OR a.phone LIKE ?
            OR a.email LIKE ?
            OR a.channel_url LIKE ?
        )`);

        const keyword = `%${search}%`;
        params.push(keyword, keyword, keyword, keyword);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [rows] = await db.execute(
        `SELECT
            a.id,
            a.user_id,
            u.email AS account_email,
            a.full_name,
            a.phone,
            a.email,
            a.channel_type,
            a.channel_url,
            a.audience_size,
            a.status,
            a.reviewed_by_user_id,
            a.reviewed_at,
            a.rejection_reason,
            a.created_at,
            a.updated_at
         FROM affiliate_applications a
         LEFT JOIN users u
            ON u.id = a.user_id
         ${where}
         ORDER BY
            CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END,
            a.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM affiliate_applications a
         ${where}`,
        params
    );

    const total = Number(countRows[0]?.total || 0);

    return {
        applications: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

// =====================================================
// ADMIN: GET APPLICATION DETAIL
// =====================================================

async function getApplicationDetail(applicationId) {
    const id = validateApplicationId(applicationId);

    const [rows] = await db.execute(
        `SELECT
            a.*,
            u.email AS account_email
         FROM affiliate_applications a
         LEFT JOIN users u
            ON u.id = a.user_id
         WHERE a.id = ?
         LIMIT 1`,
        [id]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_APPLICATION_NOT_FOUND");
    }

    return rows[0];
}

function validateApplicationId(value) {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("INVALID_APPLICATION_ID");
    }

    return id;
}

// =====================================================
// ADMIN: APPROVE APPLICATION
// =====================================================

async function approveApplication(
    applicationId,
    reviewerUserId,
    adminNote = null,
    audit = {}
) {
    const id = validateApplicationId(applicationId);
    const reviewerId = validateUserId(reviewerUserId);

    const note = optionalText(
        adminNote,
        5000,
        "INVALID_APPLICATION_ADMIN_NOTE"
    );

    return withTransaction(async conn => {
        const [applications] = await conn.execute(
            `SELECT *
             FROM affiliate_applications
             WHERE id = ?
             FOR UPDATE`,
            [id]
        );

        if (!applications.length) {
            throw new Error("AFFILIATE_APPLICATION_NOT_FOUND");
        }

        const application = applications[0];

        if (application.status !== "pending") {
            throw new Error("AFFILIATE_APPLICATION_NOT_PENDING");
        }

        const [permissionRows] = await conn.execute(
            `SELECT id
             FROM contributor_permissions
             WHERE permission_key = ?
             LIMIT 1`,
            [PERMISSION_KEY]
        );

        if (!permissionRows.length) {
            throw new Error("AFFILIATE_LINK_PERMISSION_NOT_FOUND");
        }

        const permissionId = permissionRows[0].id;

        const [directRows] = await conn.execute(
            `SELECT
                id,
                effect,
                expires_at,
                (expires_at IS NULL OR expires_at > NOW()) AS is_active
             FROM contributor_user_permissions
             WHERE user_id = ?
               AND permission_id = ?
             LIMIT 1
             FOR UPDATE`,
            [application.user_id, permissionId]
        );

        let permissionRowCreated = 0;
        let grantStatus = "active";
        let permissionGranted = true;
        let permissionReason = "existing_allow";

        if (!directRows.length) {
            await conn.execute(
                `INSERT INTO contributor_user_permissions (
                    user_id,
                    permission_id,
                    effect,
                    granted_by_user_id,
                    reason,
                    expires_at
                ) VALUES (?, ?, 'allow', ?, ?, NULL)`,
                [
                    application.user_id,
                    permissionId,
                    reviewerId,
                    `Affiliate application #${id} approved`
                ]
            );

            permissionRowCreated = 1;
            permissionReason = "created_by_affiliate_application";
        } else {
            const directPermission = directRows[0];

            if (
                directPermission.effect === "deny" ||
                Number(directPermission.is_active) !== 1
            ) {
                grantStatus = "manual_conflict";
                permissionGranted = false;

                permissionReason = directPermission.effect === "deny"
                    ? "existing_deny"
                    : "existing_expired_permission";
            } else {
                permissionReason = "existing_allow_preserved";
            }
        }

        // Create or update the grant record.
        // This also allows retrying a previous manual_conflict.
        await conn.execute(
            `INSERT INTO affiliate_permission_grants (
                application_id,
                user_id,
                permission_id,
                permission_row_created,
                status,
                granted_by_user_id,
                granted_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                permission_row_created = VALUES(permission_row_created),
                status = VALUES(status),
                granted_by_user_id = VALUES(granted_by_user_id),
                granted_at = NOW(),
                revoked_by_user_id = NULL,
                revoked_at = NULL,
                revoke_reason = NULL`,
            [
                id,
                application.user_id,
                permissionId,
                permissionRowCreated,
                grantStatus,
                reviewerId
            ]
        );

        // Permission conflict: keep application pending.
        if (!permissionGranted) {
            await writeAudit(conn, {
                actorUserId: reviewerId,
                targetUserId: application.user_id,
                action: "affiliate_application_permission_conflict",
                applicationId: id,
                oldData: {
                    status: "pending"
                },
                newData: {
                    status: "pending",
                    permissionKey: PERMISSION_KEY,
                    permissionGrantStatus: "manual_conflict",
                    permissionReason
                },
                audit
            });

            return {
                applicationId: id,
                status: "pending",
                permissionGranted: false,
                permissionGrantStatus: "manual_conflict",
                permissionReason
            };
        }

        // Permission granted or an existing allow was preserved.
        await conn.execute(
            `UPDATE affiliate_applications
             SET status = 'approved',
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW(),
                 admin_note = ?,
                 rejection_reason = NULL
             WHERE id = ?`,
            [reviewerId, note, id]
        );

        await writeAudit(conn, {
            actorUserId: reviewerId,
            targetUserId: application.user_id,
            action: "affiliate_application_approved",
            applicationId: id,
            oldData: {
                status: "pending"
            },
            newData: {
                status: "approved",
                permissionKey: PERMISSION_KEY,
                permissionGranted: true,
                permissionGrantStatus: "active",
                permissionRowCreated,
                permissionReason,
                adminNote: note
            },
            audit
        });

        return {
            applicationId: id,
            status: "approved",
            permissionGranted: true,
            permissionGrantStatus: "active",
            permissionReason
        };
    });
}


// =====================================================
// ADMIN: REJECT APPLICATION
// =====================================================

async function rejectApplication(
    applicationId,
    reviewerUserId,
    rejectionReason,
    adminNote = null,
    audit = {}
) {
    const id = validateApplicationId(applicationId);
    const reviewerId = validateUserId(reviewerUserId);

    const reason = requiredText(
        rejectionReason,
        5000,
        "APPLICATION_REJECTION_REASON_REQUIRED"
    );

    const note = optionalText(
        adminNote,
        5000,
        "INVALID_APPLICATION_ADMIN_NOTE"
    );

    return withTransaction(async conn => {
        const [applications] = await conn.execute(
            `SELECT *
             FROM affiliate_applications
             WHERE id = ?
             FOR UPDATE`,
            [id]
        );

        if (!applications.length) {
            throw new Error("AFFILIATE_APPLICATION_NOT_FOUND");
        }

        const application = applications[0];

        if (application.status !== "pending") {
            throw new Error("AFFILIATE_APPLICATION_NOT_PENDING");
        }

        await conn.execute(
            `UPDATE affiliate_applications
             SET status = 'rejected',
                 reviewed_by_user_id = ?,
                 reviewed_at = NOW(),
                 rejection_reason = ?,
                 admin_note = ?
             WHERE id = ?`,
            [reviewerId, reason, note, id]
        );

        await writeAudit(conn, {
            actorUserId: reviewerId,
            targetUserId: application.user_id,
            action: "affiliate_application_rejected",
            applicationId: id,
            oldData: {
                status: application.status
            },
            newData: {
                status: "rejected",
                rejectionReason: reason,
                adminNote: note
            },
            audit
        });

        return {
            applicationId: id,
            status: "rejected"
        };
    });
}

module.exports = {
    createApplication,
    getMyApplications,
    getApplications,
    getApplicationDetail,
    approveApplication,
    rejectApplication
};
