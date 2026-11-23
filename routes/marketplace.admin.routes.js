
"use strict";

const express = require("express");
const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");
const sellerService = require("../services/marketplace.seller.service");

const router = express.Router();

router.use(auth);

const canViewSellers = requireContributorPermission(
    "marketplace.seller.view"
);

const canManageSellers = requireContributorPermission(
    "marketplace.seller.manage"
);

const canReviewSellers = requireContributorPermission(
    "marketplace.seller.review"
);

function getAuditInfo(req) {
    return {
        ipAddress: req.ip || null,
        userAgent: req.get("user-agent") || null
    };
}

function handleError(res, error) {
    const code = error.message || "MARKETPLACE_ADMIN_OPERATION_FAILED";

    const errorMap = {
        INVALID_USER_ID: 400,
        INVALID_SELLER_ID: 400,
        INVALID_REVIEW_NOTE: 400,
        SELLER_NOT_FOUND: 404,
        TARGET_USER_NOT_FOUND: 404,
        SELLER_STATUS_INVALID: 409,
        SELLER_ALREADY_CLOSED: 409,
        SELLER_CURRENT_AGREEMENT_NOT_ACCEPTED: 409,
        MARKETPLACE_AGREEMENT_NOT_AVAILABLE: 503
    };

    const status = errorMap[code] || (
        error.code === "ER_DUP_ENTRY" ? 409 : 500
    );

    if (status === 500) {
        console.error("[MARKETPLACE ADMIN ERROR]", error);
    }

    return res.status(status).json({
        success: false,
        code,
        message: status === 500
            ? "Đã xảy ra lỗi hệ thống"
            : code
    });
}

// ========================================
// GET SELLER APPLICATIONS
// GET /api/marketplace/admin/sellers
// ========================================

router.get(
    "/sellers",
    canViewSellers,
    async (req, res) => {
        try {
            const result = await sellerService.getSellerApplications({
                status: req.query.status,
                search: req.query.search,
                page: req.query.page,
                limit: req.query.limit
            });

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// GET SELLER DETAIL
// GET /api/marketplace/admin/sellers/:id
// ========================================

router.get(
    "/sellers/:id",
    canViewSellers,
    async (req, res) => {
        try {
            const result = await sellerService.getSellerDetail(
                req.params.id
            );

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// ACTIVATE SELLER
// POST /api/marketplace/admin/sellers/:id/activate
// ========================================

router.post(
    "/sellers/:id/activate",
    canManageSellers,
    canReviewSellers,
    async (req, res) => {
        try {
            const result = await sellerService.activateSeller(
                req.params.id,
                req.user.id,
                req.body?.note,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã kích hoạt Seller",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// REJECT SELLER
// POST /api/marketplace/admin/sellers/:id/reject
// ========================================

router.post(
    "/sellers/:id/reject",
    canManageSellers,
    canReviewSellers,
    async (req, res) => {
        try {
            const result = await sellerService.rejectSeller(
                req.params.id,
                req.user.id,
                req.body?.reason,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã từ chối hồ sơ Seller",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// SUSPEND SELLER
// POST /api/marketplace/admin/sellers/:id/suspend
// ========================================

router.post(
    "/sellers/:id/suspend",
    canManageSellers,
    async (req, res) => {
        try {
            const result = await sellerService.suspendSeller(
                req.params.id,
                req.user.id,
                req.body?.reason,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã tạm ngưng Seller",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// CLOSE SELLER
// POST /api/marketplace/admin/sellers/:id/close
// ========================================

router.post(
    "/sellers/:id/close",
    canManageSellers,
    async (req, res) => {
        try {
            const result = await sellerService.closeSeller(
                req.params.id,
                req.user.id,
                req.body?.reason,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã đóng tài khoản Seller",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

module.exports = router;
