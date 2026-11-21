
"use strict";

const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");

const productService = require("../services/affiliate.product.service");
const reportService = require("../services/affiliate.report.service");
const attributionService = require("../services/affiliate.attribution.service");
const productImportService = require("../services/affiliate.product-import.service");

router.use(auth);

// =====================================================
// HELPERS
// =====================================================

function auditInfo(req) {
    return {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null
    };
}

function positiveId(value, error = "INVALID_AFFILIATE_NETWORK_ID") {
    const id = String(value ?? "").trim();

    if (!/^[1-9]\d*$/.test(id)) {
        throw new Error(error);
    }

    return id;
}

function optionalPositiveId(value, error) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    return positiveId(value, error);
}

function pagination(query = {}) {
    const parseInteger = (value, fallback, min, max, error) => {
        if (value === undefined || value === "") {
            return fallback;
        }

        const raw = String(value).trim();

        if (!/^\d+$/.test(raw)) {
            throw new Error(error);
        }

        const number = Number(raw);

        if (!Number.isSafeInteger(number) || number < min || number > max) {
            throw new Error(error);
        }

        return number;
    };

    const page = parseInteger(
        query.page,
        1,
        1,
        1000000,
        "INVALID_PAGINATION_PAGE"
    );

    const limit = parseInteger(
        query.limit,
        20,
        1,
        1000,
        "INVALID_PAGINATION_LIMIT"
    );

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function optionalEnum(value, allowed, error) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();

    if (!allowed.includes(normalized)) {
        throw new Error(error);
    }

    return normalized;
}

function optionalText(value, maxLength, error) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const result = String(value).trim();

    if (!result || result.length > maxLength) {
        throw new Error(error);
    }

    return result;
}



function sendError(res, error) {
    const code = error.message || "AFFILIATE_OPERATION_FAILED";

    const badRequestErrors = [
        "INVALID_AFFILIATE_NETWORK_ID",
        "INVALID_AFFILIATE_PRODUCT_ID",
        "INVALID_AFFILIATE_CATEGORY_ID",
        "INVALID_AFFILIATE_ORDER_ID",
        "INVALID_AFFILIATE_CLICK_CODE",
        "INVALID_ACTOR_USER_ID",
        "INVALID_AFFILIATE_SYNC_TYPE",
        "INVALID_PAGINATION_PAGE",
        "INVALID_PAGINATION_LIMIT",
        "INVALID_SYNC_STATUS",
        "INVALID_SYNC_DATA_TYPE",
        "INVALID_ORDER_ATTRIBUTION_STATUS",
        "INVALID_ORDER_PAYMENT_STATUS",
        "INVALID_ORDER_STATUS",
        "INVALID_COMMISSION_EVENT_TYPE",
        "INVALID_COMMISSION_STATUS",
        "INVALID_COMMISSION_ORDER_ID",
        "INVALID_SEARCH_KEYWORD",
        "AFFILIATE_REPORT_EMPTY",
        "AFFILIATE_NETWORK_REQUIRED",
        "AFFILIATE_IMPORT_DATA_REQUIRED",
        "AFFILIATE_IMPORT_TOO_MANY_ROWS",
        "AFFILIATE_IMPORT_DUPLICATE_ROW",
        "AFFILIATE_ORDER_IDENTIFIER_REQUIRED",
        "INVALID_PRODUCT_TITLE",
        "INVALID_PRODUCT_PRICE",
        "INVALID_PRODUCT_CURRENCY",
        "INVALID_PRODUCT_URL",
        "INVALID_PRODUCT_STATUS",
        "INVALID_PRODUCT_SOURCE_TYPE",
        "INVALID_PRODUCT_TEXT_LENGTH",
        "INVALID_PRODUCT_IMPORT_ROW",
        "INVALID_PRODUCT_IMAGE_URL",
        "INVALID_AFFILIATE_LINK",
        "INVALID_FINAL_URL",
        "INVALID_EXTERNAL_PRODUCT_ID",
        "INVALID_EXTERNAL_SKU_ID",
        "INVALID_PRODUCT_IMPORT_ROW",
        "INVALID_CATEGORY_ID",
        "INVALID_AFFILIATE_SYNC_TYPE",
        "AFFILIATE_NETWORK_MISMATCH",
        "AFFILIATE_PRODUCT_MISMATCH",
        "AFFILIATE_SKU_MISMATCH",
        "AFFILIATE_CLICK_TIME_INVALID",
        "AFFILIATE_ORDER_ALREADY_ATTRIBUTED",
        "AFFILIATE_CLICK_NOT_ELIGIBLE",
        "AFFILIATE_PRODUCT_DELETE_IDS_REQUIRED",
        "AFFILIATE_PRODUCT_DELETE_TOO_MANY",
    ];

    const notFoundErrors = [
        "AFFILIATE_NETWORK_NOT_FOUND",
        "AFFILIATE_PRODUCT_NOT_FOUND",
        "AFFILIATE_CATEGORY_NOT_FOUND",
        "AFFILIATE_ORDER_NOT_FOUND",
        "AFFILIATE_CLICK_NOT_FOUND"
    ];

    const conflictErrors = [
        "AFFILIATE_PRODUCT_ALREADY_EXISTS",
        "AFFILIATE_PRODUCT_HAS_CLICKS",
        "AFFILIATE_PRODUCT_HAS_ORDERS"
    ];

    const status = badRequestErrors.includes(code)
        ? 400
        : notFoundErrors.includes(code)
            ? 404
            : conflictErrors.includes(code)
                ? 409
                : 500;

    return res.status(status).json({
        success: false,
        code,
        message: status === 500
            ? "Affiliate operation failed"
            : code
    });
}

// =====================================================
// PRODUCTS
// =====================================================

router.get(
    "/products",
    requireContributorPermission("affiliate.view"),
    async (req, res) => {
        try {
            const result = await productService.getAdminProducts(req.query);

            return res.json({
                success: true,
                ...result
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.get(
    "/products/:id",
    requireContributorPermission("affiliate.view"),
    async (req, res) => {
        try {
            const product = await productService.getProductDetail(
                req.params.id,
                { includeInactive: true }
            );

            return res.json({
                success: true,
                product
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.post(
    "/products",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const product = await productService.createProduct(
                req.body,
                req.user.id,
                auditInfo(req)
            );

            return res.status(201).json({
                success: true,
                product
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);


// =====================================================
// BULK APPROVE PRODUCTS
// =====================================================

router.put(
    "/products/bulk-approve",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const result = await productService.bulkApproveProducts(
                req.body.ids,
                req.user.id,
                auditInfo(req)
            );

            return res.json({
                success: true,
                ...result
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.put(
    "/products/approve-all",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const result = await productService.bulkApproveAllDraftProducts(
                req.body || {},
                req.user.id,
                auditInfo(req)
            );

            return res.json({
                success: true,
                ...result
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.put(
    "/products/:id",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const product = await productService.updateProduct(
                req.params.id,
                req.body,
                req.user.id,
                auditInfo(req)
            );

            return res.json({
                success: true,
                product
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);


// =====================================================
// DELETE PRODUCTS
// =====================================================

router.delete(
    "/products/bulk",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const result = await productService.bulkDeleteProducts(
                req.body?.ids,
                req.user.id,
                auditInfo(req)
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.delete(
    "/products/:id",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const result = await productService.deleteProduct(
                req.params.id,
                req.user.id,
                auditInfo(req)
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.put(
    "/products/:id/status",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const product = await productService.changeProductStatus(
                req.params.id,
                req.user.id,
                req.body.status,
                auditInfo(req)
            );

            return res.json({
                success: true,
                product
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// PRODUCT IMPORT
// =====================================================

router.post(
    "/products/import/preview",
    requireContributorPermission("affiliate.sync"),
    async (req, res) => {
        try {
            if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }
  // KIỂM TRA ROWS TẠI ĐÂY
            if (!Array.isArray(req.body.rows) || !req.body.rows.length) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }

            const result = await productImportService.previewProductsImport(
                req.body.rows,
                {
                    networkCode: req.body.networkCode,
                    networkId: req.body.networkId
                }
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);

router.post(
    "/products/import/commit",
    requireContributorPermission("affiliate.sync"),
    async (req, res) => {
        try {
            if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }
 // KIỂM TRA ROWS TẠI ĐÂY
            if (!Array.isArray(req.body.rows) || !req.body.rows.length) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }

            const result = await productImportService.commitProductsImport(
                req.body.rows,
                {
                    networkCode: req.body.networkCode,
                    networkId: req.body.networkId,
                    syncType: req.body.syncType || "csv_import",
                    categoryId: req.body.categoryId,
                    defaultStatus: req.body.status || "draft",
                    createdBy: req.user.id,
                    audit: auditInfo(req)
                }
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);


// =====================================================
// CATEGORIES
// =====================================================

router.get(
    "/categories",
    requireContributorPermission("affiliate.view"),
    async (req, res) => {
        try {
            const categories = await productService.getCategories({
                includeInactive: true
            });

            return res.json({
                success: true,
                categories
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// CONVERSION REPORT IMPORT
// =====================================================

router.post(
    "/reports/conversions/import",
    requireContributorPermission("affiliate.sync"),
    async (req, res) => {
        try {
            if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }

            const rows = req.body.rows;

            if (!Array.isArray(rows) || !rows.length) {
                throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
            }

            const networkCode = optionalText(
                req.body.networkCode || "lazada",
                50,
                "AFFILIATE_NETWORK_REQUIRED"
            );

            const syncType = optionalEnum(
                req.body.syncType || "manual_import",
                [
                    "manual_import",
                    "csv_import",
                    "excel_import",
                    "api_sync"
                ],
                "INVALID_AFFILIATE_SYNC_TYPE"
            );

            const result = await reportService.importConversionReport(
                rows,
                {
                    networkCode,
                    syncType,
                    createdBy: req.user.id
                }
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// SYNC HISTORY
// =====================================================

router.get(
    "/sync-logs",
    requireContributorPermission("affiliate.view"),
    async (req, res) => {
        try {
            const { page, limit, offset } = pagination(req.query);

            const conditions = [];
            const params = [];

            const networkId = optionalPositiveId(
                req.query.networkId,
                "INVALID_AFFILIATE_NETWORK_ID"
            );

            const status = optionalEnum(
                req.query.status,
                ["running", "success", "partial", "failed"],
                "INVALID_SYNC_STATUS"
            );

            const dataType = optionalEnum(
                req.query.dataType,
                ["products", "conversions", "performance"],
                "INVALID_SYNC_DATA_TYPE"
            );

            if (networkId) {
                conditions.push("l.network_id = ?");
                params.push(networkId);
            }

            if (status) {
                conditions.push("l.status = ?");
                params.push(status);
            }

            if (dataType) {
                conditions.push("l.data_type = ?");
                params.push(dataType);
            }

            const where = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

            const [rows] = await db.execute(
                `SELECT
                    l.id,
                    l.network_id,
                    n.code AS network_code,
                    n.name AS network_name,
                    l.sync_type,
                    l.data_type,
                    l.status,
                    l.total_rows,
                    l.success_rows,
                    l.failed_rows,
                    l.error_message,
                    l.created_by,
                    l.started_at,
                    l.completed_at,
                    l.created_at
                 FROM affiliate_sync_logs l
                 JOIN affiliate_networks n
                    ON n.id = l.network_id
                 ${where}
                 ORDER BY l.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const [countRows] = await db.execute(
                `SELECT COUNT(*) AS total
                 FROM affiliate_sync_logs l
                 ${where}`,
                params
            );

            const total = Number(countRows[0].total || 0);

            return res.json({
                success: true,
                logs: rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// AFFILIATE ORDERS
// =====================================================

router.get(
    "/orders",
    requireContributorPermission("affiliate.order.view"),
    async (req, res) => {
        try {
            const { page, limit, offset } = pagination(req.query);

            const conditions = [];
            const params = [];

            const networkId = optionalPositiveId(
                req.query.networkId,
                "INVALID_AFFILIATE_NETWORK_ID"
            );

            const attributionStatus = optionalEnum(
                req.query.attributionStatus,
                ["pending", "matched", "unmatched", "verified"],
                "INVALID_ORDER_ATTRIBUTION_STATUS"
            );

            const paymentStatus = optionalText(
                req.query.paymentStatus,
                100,
                "INVALID_ORDER_PAYMENT_STATUS"
            );

            const orderStatus = optionalText(
                req.query.orderStatus,
                100,
                "INVALID_ORDER_STATUS"
            );

            const search = optionalText(
                req.query.search,
                150,
                "INVALID_SEARCH_KEYWORD"
            );

            if (networkId) {
                conditions.push("o.network_id = ?");
                params.push(networkId);
            }

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
                    o.external_checkout_id LIKE ?
                    OR o.external_sub_order_id LIKE ?
                    OR o.product_name LIKE ?
                )`);

                const keyword = `%${search}%`;

                params.push(keyword, keyword, keyword);
            }

            const where = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

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
                    o.payment_advice_id,
                    o.payment_bill_period,
                    o.attribution,
                    o.aff_sub_id,
                    o.sub_id_1,
                    o.sub_id_2,
                    o.sub_id_3,
                    o.sub_id_4,
                    o.sub_id_5,
                    o.sub_id_6,
                    o.click_id,
                    o.attribution_status,
                    c.user_id AS attributed_user_id,
                    o.imported_at,
                    o.created_at,
                    o.updated_at
                 FROM affiliate_orders o
                 JOIN affiliate_networks n
                    ON n.id = o.network_id
                 LEFT JOIN affiliate_clicks c
                    ON c.id = o.click_id
                 ${where}
                 ORDER BY o.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const [countRows] = await db.execute(
                `SELECT COUNT(*) AS total
                 FROM affiliate_orders o
                 ${where}`,
                params
            );

            const total = Number(countRows[0].total || 0);

            return res.json({
                success: true,
                orders: rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// AFFILIATE COMMISSIONS
// =====================================================

router.get(
    "/commissions",
    requireContributorPermission("affiliate.order.view"),
    async (req, res) => {
        try {
            const { page, limit, offset } = pagination(req.query);

            const conditions = [];
            const params = [];

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

            if (networkId) {
                conditions.push("c.network_id = ?");
                params.push(networkId);
            }

            if (eventType) {
                conditions.push("c.event_type = ?");
                params.push(eventType);
            }

            if (status) {
                conditions.push("c.status = ?");
                params.push(status);
            }

            if (orderId) {
                conditions.push("c.order_id = ?");
                params.push(orderId);
            }

            const where = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

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
                    o.attribution_status,
                    ac.user_id AS attributed_user_id
                 FROM affiliate_commissions c
                 JOIN affiliate_networks n
                    ON n.id = c.network_id
                 JOIN affiliate_orders o
                    ON o.id = c.order_id
                 LEFT JOIN affiliate_clicks ac
                    ON ac.id = o.click_id
                 ${where}
                 ORDER BY c.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const [countRows] = await db.execute(
                `SELECT COUNT(*) AS total
                 FROM affiliate_commissions c
                 ${where}`,
                params
            );

            const total = Number(countRows[0].total || 0);

            return res.json({
                success: true,
                commissions: rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
);

// =====================================================
// ORDER ATTRIBUTION
// =====================================================

router.post(
    "/orders/:id/attribute",
    requireContributorPermission("affiliate.manage"),
    async (req, res) => {
        try {
            const orderId = positiveId(
                req.params.id,
                "INVALID_AFFILIATE_ORDER_ID"
            );

            if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
                throw new Error("INVALID_AFFILIATE_CLICK_CODE");
            }

            const result = await attributionService.matchOrderToClick(
                orderId,
                req.body.clickCode,
                req.user.id,
                auditInfo(req)
            );

            return res.json(result);
        } catch (error) {
            return sendError(res, error);
        }
    }
);

module.exports = router;
