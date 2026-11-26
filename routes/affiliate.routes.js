
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const db = require("../db");

const productService = require("../services/affiliate.product.service");
const trackingService = require("../services/affiliate.tracking.service");
const contributorPermissionService =
    require("../services/contributor.permission.service");

const requireContributorPermission =
    require("../middleware/requireContributorPermission");

const ERROR_STATUS = {
    INVALID_USER_ID: 400,
    INVALID_PRODUCT_ID: 400,
    INVALID_AFFILIATE_PRODUCT_ID: 400,
    INVALID_AFFILIATE_NETWORK_ID: 400,
    INVALID_CATEGORY_ID: 400,
    INVALID_PAGE: 400,
    INVALID_LIMIT: 400,
    INVALID_SEARCH: 400,
    INVALID_AFFILIATE_CLICK_CODE: 400,
    INVALID_AFFILIATE_DESTINATION: 400,
    INVALID_COMMISSION_ORDER_ID: 400,
    INVALID_COMMISSION_EVENT_TYPE: 400,
    INVALID_COMMISSION_STATUS: 400,
    INVALID_AFFILIATE_ORDER_STATUS: 400,
    INVALID_AFFILIATE_PAYMENT_STATUS: 400,
    INVALID_AFFILIATE_ATTRIBUTION_STATUS: 400,

    AFFILIATE_PRODUCT_NOT_FOUND: 404,
    AFFILIATE_CLICK_NOT_FOUND: 404,

    AFFILIATE_PRODUCT_NOT_ACTIVE: 409,
    AFFILIATE_PRODUCT_INACTIVE: 409,
    AFFILIATE_NETWORK_INACTIVE: 409,
    AFFILIATE_CLICK_NOT_ELIGIBLE: 409,
    UNSUPPORTED_AFFILIATE_NETWORK: 409,
    AFFILIATE_CLICK_DESTINATION_MISMATCH: 409
};

function getErrorStatus(error) {
    return ERROR_STATUS[error.message] || 500;
}

function handleError(res, error) {
    const status = getErrorStatus(error);

    if (status === 500) {
        console.error("[AFFILIATE ERROR]", error);
    }

    return res.status(status).json({
        success: false,
        code: error.message || "AFFILIATE_OPERATION_FAILED",
        message: status === 500
            ? "Có lỗi xảy ra khi xử lý Affiliate"
            : error.message
    });
}

function positiveId(value, errorCode = "INVALID_USER_ID") {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(errorCode);
    }

    return id;
}

function optionalPositiveId(value, errorCode) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    return positiveId(value, errorCode);
}

function optionalEnum(value, allowed, errorCode) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const normalized = String(value).trim();

    if (!allowed.includes(normalized)) {
        throw new Error(errorCode);
    }

    return normalized;
}

function optionalText(value, errorCode = "INVALID_SEARCH", maxLength = 100) {
    if (value === undefined || value === null || value === "") {
        return "";
    }

    if (typeof value !== "string") {
        throw new Error(errorCode);
    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {
        throw new Error(errorCode);
    }

    return normalized;
}

function pagination(query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? 20 : Number(query.limit);

    if (!Number.isSafeInteger(page) || page < 1) {
        throw new Error("INVALID_PAGE");
    }

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("INVALID_LIMIT");
    }

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function getAuthenticatedUserId(req) {
    return positiveId(req.user?.id, "INVALID_USER_ID");
}

/* =====================================================
   PUBLIC REDIRECT + CLICK TRACKING
===================================================== */

router.get("/go/:clickCode", async (req, res) => {
    try {
        const destination = await trackingService.getClickDestination(
            req.params.clickCode,
            {
                ip: req.ip,
                userAgent: req.get("user-agent")
            }
        );

        return res.redirect(302, destination);

    } catch (error) {
        const status = getErrorStatus(error);

        return res.status(status).send(
            status === 404
                ? "Affiliate link không tồn tại."
                : status === 409
                    ? "Affiliate link hiện không khả dụng."
                    : status === 500
                        ? "Không thể xử lý Affiliate link."
                        : "Affiliate link không hợp lệ."
        );
    }
});

/* GET CATEGORIES */

router.get("/categories", async (req, res) => {
    try {
        const categories = await productService.getCategories();

        return res.json({
            success: true,
            categories
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* GET PRODUCTS */

router.get("/products", async (req, res) => {
    try {
        const result = await productService.getProducts(req.query);

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* GET PRODUCT DETAIL */

router.get("/products/:id", async (req, res) => {
    try {
        const product = await productService.getProductDetail(
            req.params.id
        );

        return res.json({
            success: true,
            product
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* =====================================================
   AUTHENTICATED ROUTES
===================================================== */
router.use(auth);

/* GET CURRENT USER AFFILIATE PERMISSIONS */

router.get("/permissions", async (req, res) => {
    try {
        const result =
            await contributorPermissionService.getUserPermissions(
                getAuthenticatedUserId(req)
            );

        return res.json({
            success: true,
            permissions: result.permissions,
            isSuperAdmin: result.isSuperAdmin,
            canCreateLink: result.permissions.includes(
                "affiliate.link.create"
            )
        });
    } catch (error) {
        return handleError(res, error);
    }
});
/* CREATE SHARE LINK */

router.post(
    "/links",
    requireContributorPermission("affiliate.link.create"),
    async (req, res) => {
    try {
        const result = await trackingService.createLink(
            getAuthenticatedUserId(req),
            req.body.productId
        );

        return res.status(201).json({
            success: true,
            ...result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* GET MY LINKS */

router.get("/links", async (req, res) => {
    try {
        const result = await trackingService.getLinks(
            getAuthenticatedUserId(req),
            req.query
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* LEGACY CLICK API - KEEP COMPATIBILITY */

router.post(
    "/click",
    requireContributorPermission("affiliate.link.create"),
    async (req, res) => {
    try {
        const result = await trackingService.createClick(
            getAuthenticatedUserId(req),
            req.body.productId
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

/* =====================================================
   MEMBER ORDERS
   Chỉ lấy đơn hàng thuộc link của thành viên đăng nhập.
===================================================== */

router.get("/orders", async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const { page, limit, offset } = pagination(req.query);

        const networkId = optionalPositiveId(
            req.query.networkId,
            "INVALID_AFFILIATE_NETWORK_ID"
        );

        const attributionStatus = optionalEnum(
            req.query.attributionStatus,
            ["pending", "matched", "unmatched", "verified"],
            "INVALID_AFFILIATE_ATTRIBUTION_STATUS"
        );

        const paymentStatus = optionalText(
            req.query.paymentStatus,
            "INVALID_AFFILIATE_PAYMENT_STATUS",
            80
        );

        const orderStatus = optionalText(
            req.query.orderStatus,
            "INVALID_AFFILIATE_ORDER_STATUS",
            80
        );

        const search = optionalText(req.query.search);

        const baseConditions = [
            `EXISTS (
                SELECT 1
                FROM affiliate_clicks member_click
                WHERE member_click.id = o.click_id
                  AND member_click.user_id = ?
            )`
        ];

        const baseParams = [userId];

        if (networkId) {
            baseConditions.push("o.network_id = ?");
            baseParams.push(networkId);
        }

        const conditions = [...baseConditions];
        const params = [...baseParams];

        if (attributionStatus) {
            conditions.push("o.attribution_status = ?");
            params.push(attributionStatus);
        }

        if (paymentStatus) {
            conditions.push("o.payment_status = ?");
            params.push(paymentStatus);
        }

        if (orderStatus) {
            conditions.push("o.order_status = ?");
            params.push(orderStatus);
        }

        if (search) {
            conditions.push(`(
                o.product_name LIKE ?
                OR o.external_checkout_id LIKE ?
                OR o.external_sub_order_id LIKE ?
                OR o.product_external_id LIKE ?
                OR o.sku_external_id LIKE ?
            )`);

            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword, keyword, keyword);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const baseWhere = `WHERE ${baseConditions.join(" AND ")}`;

        const [rows] = await db.execute(
            `SELECT
                o.id,
                o.network_id,
                n.code AS network_code,
                o.external_checkout_id,
                o.external_sub_order_id,
                o.product_external_id,
                o.sku_external_id,
                o.product_name,
                o.order_status,
                o.platform,
                o.country,
                o.conversion_time,
                o.fulfilled_time,
                o.delivered_time,
                o.returned_time,
                o.order_amount,
                o.adjustment,
                o.currency,
                o.commission_rate,
                o.payout,
                o.validity,
                o.payment_status,
                o.payment_bill_period,
                o.attribution_status,
                o.imported_at,
                o.created_at
             FROM affiliate_orders o
             JOIN affiliate_networks n
                ON n.id = o.network_id
             ${where}
             ORDER BY o.conversion_time DESC, o.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM affiliate_orders o
             ${where}`,
            params
        );

        const [statsRows] = await db.execute(
            `SELECT
                COUNT(*) AS total_orders,
                SUM(CASE
                    WHEN LOWER(COALESCE(o.order_status, '')) IN
                        ('approved', 'confirmed', 'completed', 'delivered', 'paid')
                    THEN 1 ELSE 0
                END) AS valid_orders,
                SUM(COALESCE(o.order_amount, 0)) AS total_order_amount,
                SUM(COALESCE(o.payout, 0)) AS total_payout
             FROM affiliate_orders o
             ${baseWhere}`,
            baseParams
        );

        const [currencyRows] = await db.execute(
            `SELECT
                COALESCE(o.currency, 'VND') AS currency,
                COUNT(*) AS order_count,
                SUM(COALESCE(o.order_amount, 0)) AS order_amount,
                SUM(COALESCE(o.payout, 0)) AS payout
             FROM affiliate_orders o
             ${baseWhere}
             GROUP BY COALESCE(o.currency, 'VND')
             ORDER BY currency`,
            baseParams
        );

        const total = Number(countRows[0]?.total || 0);
        const stats = statsRows[0] || {};

        return res.json({
            success: true,
            orders: rows,
            stats: {
                totalOrders: Number(stats.total_orders || 0),
                validOrders: Number(stats.valid_orders || 0),
                totalOrderAmount: Number(stats.total_order_amount || 0),
                totalPayout: Number(stats.total_payout || 0),
                byCurrency: currencyRows.map(row => ({
                    currency: row.currency,
                    orderCount: Number(row.order_count || 0),
                    orderAmount: Number(row.order_amount || 0),
                    payout: Number(row.payout || 0)
                }))
            },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        return handleError(res, error);
    }
});


/* =====================================================
   MEMBER COMMISSIONS
   Hiển thị hoa hồng Affiliate dưới dạng Credits.
===================================================== */

router.get("/commissions", async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const { page, limit, offset } = pagination(req.query);

        const networkId = optionalPositiveId(
            req.query.networkId,
            "INVALID_AFFILIATE_NETWORK_ID"
        );

        const orderId = optionalPositiveId(
            req.query.orderId,
            "INVALID_COMMISSION_ORDER_ID"
        );

        const eventType = optionalEnum(
            req.query.eventType,
            ["commission", "adjustment", "reversal"],
            "INVALID_COMMISSION_EVENT_TYPE"
        );

        const status = optionalEnum(
            req.query.status,
            ["pending", "confirmed", "reversed"],
            "INVALID_COMMISSION_STATUS"
        );

        const search = optionalText(req.query.search);

        const baseConditions = [
            `EXISTS (
                SELECT 1
                FROM affiliate_orders member_order
                JOIN affiliate_clicks member_click
                    ON member_click.id = member_order.click_id
                WHERE member_order.id = c.order_id
                  AND member_click.user_id = ?
            )`
        ];

        const baseParams = [userId];

        if (networkId) {
            baseConditions.push("c.network_id = ?");
            baseParams.push(networkId);
        }

        const conditions = [...baseConditions];
        const params = [...baseParams];

        if (orderId) {
            conditions.push("c.order_id = ?");
            params.push(orderId);
        }

        if (eventType) {
            conditions.push("c.event_type = ?");
            params.push(eventType);
        }

        if (status) {
            conditions.push("c.status = ?");
            params.push(status);
        }

        if (search) {
            conditions.push(`(
                o.product_name LIKE ?
                OR o.external_checkout_id LIKE ?
                OR o.external_sub_order_id LIKE ?
            )`);

            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const baseWhere = `WHERE ${baseConditions.join(" AND ")}`;

        // Danh sách commission và giao dịch Credits thực tế.
        const [rows] = await db.execute(
            `SELECT
                c.id,
                c.network_id,
                n.code AS network_code,
                c.order_id,
                o.external_checkout_id,
                o.external_sub_order_id,
                o.product_name,
                c.event_type,
                c.amount,
                c.currency,
                c.status,
                c.reward_transaction_id,
                c.processed_at,
                c.created_at,
                o.order_status,
                o.payment_status,
                o.attribution_status,
                o.conversion_time,

                COALESCE((
                    SELECT SUM(rt.amount)
                    FROM reward_transactions rt
                    WHERE rt.reference_type = 'affiliate_commission'
                      AND CAST(rt.reference_id AS UNSIGNED) = c.id
                      AND rt.type = 'credit'
                      AND rt.source = 'affiliate'
                ), 0) AS credited_amount,

                COALESCE((
                    SELECT r.amount
                    FROM affiliate_credit_recoveries r
                    WHERE r.commission_id = c.id
                    LIMIT 1
                ), 0) AS recovery_amount,

                COALESCE((
                    SELECT r.recovered_amount
                    FROM affiliate_credit_recoveries r
                    WHERE r.commission_id = c.id
                    LIMIT 1
                ), 0) AS recovered_amount,

                (
                    SELECT r.status
                    FROM affiliate_credit_recoveries r
                    WHERE r.commission_id = c.id
                    LIMIT 1
                ) AS recovery_status,

                (
                    SELECT COUNT(*)
                    FROM reward_transactions rt
                    WHERE rt.reference_type = 'affiliate_commission'
                      AND CAST(rt.reference_id AS UNSIGNED) = c.id
                      AND rt.type = 'credit'
                      AND rt.source = 'affiliate'
                ) AS credited_transactions,

                (
                    SELECT COUNT(*)
                    FROM reward_transactions rt
                    WHERE rt.reference_type = 'affiliate_commission'
                      AND CAST(rt.reference_id AS UNSIGNED) = c.id
                      AND rt.type = 'reversal'
                      AND rt.source = 'affiliate'
                ) AS recovery_transactions

             FROM affiliate_commissions c
             JOIN affiliate_networks n
                ON n.id = c.network_id
             JOIN affiliate_orders o
                ON o.id = c.order_id
             ${where}
             ORDER BY c.created_at DESC, c.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM affiliate_commissions c
             JOIN affiliate_orders o
                ON o.id = c.order_id
             ${where}`,
            params
        );

        // Thống kê Credits thực tế từ Reward Wallet.
        const [statsRows] = await db.execute(
            `SELECT
                COALESCE(SUM(
                    CASE
                        WHEN rt.type = 'credit'
                        THEN rt.amount
                        ELSE 0
                    END
                ), 0) AS credited_amount,

                COALESCE(SUM(
                    CASE
                        WHEN rt.type = 'reversal'
                        THEN rt.amount
                        ELSE 0
                    END
                ), 0) AS recovered_amount,

                COUNT(DISTINCT c.id) AS total_records,

                COALESCE(SUM(
                    CASE
                        WHEN c.status = 'pending'
                         AND c.event_type IN ('commission', 'adjustment')
                         AND c.currency = 'VND'
                        THEN c.amount
                        ELSE 0
                    END
                ), 0) AS pending_amount

             FROM affiliate_commissions c

             JOIN affiliate_orders o
                ON o.id = c.order_id

             LEFT JOIN reward_transactions rt
                ON rt.user_id = ?
               AND rt.source = 'affiliate'
               AND (
                    (
                        rt.reference_type = 'affiliate_commission'
                        AND CAST(rt.reference_id AS UNSIGNED) = c.id
                        AND rt.type IN ('credit', 'reversal')
                    )
                    OR
                    (
                        rt.reference_type = 'affiliate_credit_recovery'
                        AND rt.type = 'reversal'
                        AND EXISTS (
                            SELECT 1
                            FROM affiliate_credit_recoveries ar
                            WHERE ar.id = CAST(rt.reference_id AS UNSIGNED)
                              AND ar.commission_id = c.id
                              AND ar.user_id = ?
                        )
                    )
               )

             ${baseWhere}`,
            [userId, userId, ...baseParams]
        );

        const stats = statsRows[0] || {};

        const total = Number(countRows[0]?.total || 0);

        // Chuyển DECIMAL từ MySQL thành BigInt an toàn.
        // Chỉ chấp nhận số nguyên hoặc số thập phân có phần lẻ bằng 0.
        const toCreditsBigInt = (value) => {
            const normalized = String(value ?? "0").trim();

            if (!/^-?\d+(?:\.0+)?$/.test(normalized)) {
                throw new Error(`Invalid Credits amount: ${normalized}`);
            }

            return BigInt(normalized.split(".")[0]);
        };

        const creditedAmount = toCreditsBigInt(stats.credited_amount);
        const recoveredAmount = toCreditsBigInt(stats.recovered_amount);
        const pendingAmount = toCreditsBigInt(stats.pending_amount);

        return res.json({
            success: true,

            commissions: rows.map(row => ({
                ...row,
                creditedAmount: String(row.credited_amount || 0),
                recoveryAmount: String(row.recovery_amount || 0),
                recoveredAmount: String(row.recovered_amount || 0),
                recoveryStatus: row.recovery_status || null,
                creditedTransactions: Number(row.credited_transactions || 0),
                recoveryTransactions: Number(row.recovery_transactions || 0)
            })),

            stats: {
                totalRecords: Number(stats.total_records || 0),
                creditedAmount: creditedAmount.toString(),
                recoveredAmount: recoveredAmount.toString(),
                netCredits: (creditedAmount - recoveredAmount).toString(),
                pendingAmount: pendingAmount.toString()
            },

            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        return handleError(res, error);
    }
});

module.exports = router;

