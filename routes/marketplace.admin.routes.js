
"use strict";

const express = require("express");
const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");
const sellerService = require("../services/marketplace.seller.service");
const productService = require("../services/marketplace.product.service");
const canViewProducts = requireContributorPermission("marketplace.product.view");
const canModerateProducts = requireContributorPermission("marketplace.product.moderate");
const supportAdminService = require("../services/marketplace.support.admin.service");
const canViewSupport = requireContributorPermission("marketplace.support.view");
const canManageSupport = requireContributorPermission("marketplace.support.manage");
const commissionHoldAdminService = require("../services/marketplace.commission.hold.admin.service");
const dashboardService = require("../services/marketplace.admin.dashboard.service");

const canManageCommissions = requireContributorPermission(
    "marketplace.commission.manage"
);

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
        MARKETPLACE_AGREEMENT_NOT_AVAILABLE: 503,
        INVALID_PRODUCT_ID: 400,
        INVALID_PRODUCT_TYPE: 400,
        INVALID_PRODUCT_DECISION: 400,
        INVALID_REVIEW_FEEDBACK: 400,
        INVALID_REVIEW_CHECKLIST: 400,
        PRODUCT_NOT_FOUND: 404,
        PRODUCT_ALREADY_ARCHIVED: 409,
        PRODUCT_NOT_IN_REVIEW: 409,
        PRODUCT_CANNOT_BE_SUSPENDED: 409,
        PRODUCT_NOT_APPROVED: 409,
        INVALID_ID: 400,
        INVALID_TICKET_STATUS: 400,
        INVALID_TICKET_RESOLUTION: 400,
        TICKET_RESOLUTION_REQUIRED: 400,
        SUPPORT_TICKET_NOT_FOUND: 404,
        SUPPORT_TICKET_ALREADY_CLOSED: 409,
        INVALID_ID: 400,
        INVALID_COMMISSION_HOLD_REASON: 400,
        INVALID_COMMISSION_HOLD_RELEASE_NOTE: 400,
        COMMISSION_NOT_FOUND: 404,
        COMMISSION_HOLD_NOT_FOUND: 404,
        COMMISSION_NOT_HOLDABLE: 409,
        COMMISSION_HOLD_NOT_ADMIN_OWNED: 409,
        COMMISSION_HOLD_ALREADY_RELEASED: 409,
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
// MARKETPLACE ADMIN DASHBOARD
// GET /api/marketplace/admin/dashboard
// ========================================

router.get("/dashboard", canViewSellers, async (req, res) => {
    try {
        const result = await dashboardService.getMarketplaceAdminDashboard({
            includeFinance: req.user?.isAdmin === true
        });

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

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

// ========================================
// ADMIN: PRODUCTS
// ========================================

router.get("/products", canViewProducts, async (req, res) => {
    try {
        const result = await productService.getAdminProducts(req.query);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/products/:id", canViewProducts, async (req, res) => {
    try {
        const result = await productService.getAdminProductDetail(
            req.params.id
        );

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/products/:id/approve", canModerateProducts, async (req, res) => {
    try {
        const result = await productService.moderateProduct(
            req.params.id,
            req.user.id,
            "approved",
            req.body?.feedback,
            req.body?.checklist,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã duyệt sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/products/:id/reject", canModerateProducts, async (req, res) => {
    try {
        const result = await productService.moderateProduct(
            req.params.id,
            req.user.id,
            "rejected",
            req.body?.feedback,
            req.body?.checklist,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã từ chối sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/products/:id/request-revision", canModerateProducts, async (req, res) => {
    try {
        const result = await productService.moderateProduct(
            req.params.id,
            req.user.id,
            "revision_required",
            req.body?.feedback,
            req.body?.checklist,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã yêu cầu Seller chỉnh sửa sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/products/:id/suspend", canModerateProducts, async (req, res) => {
    try {
        const result = await productService.moderateProduct(
            req.params.id,
            req.user.id,
            "suspended",
            req.body?.feedback,
            req.body?.checklist,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã đình chỉ sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/products/:id/publish", canModerateProducts, async (req, res) => {
    try {
        const result = await productService.publishProduct(
            req.params.id,
            req.user.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã xuất bản sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Danh sách khiếu nại Marketplace
router.get("/support-tickets", canViewSupport, async (req, res) => {
    try {
        const result = await supportAdminService.getTickets(req.query);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Chi tiết khiếu nại
router.get("/support-tickets/:id", canViewSupport, async (req, res) => {
    try {
        const result = await supportAdminService.getTicketDetail(
            req.params.id
        );

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Cập nhật trạng thái khiếu nại
router.put("/support-tickets/:id/status", canManageSupport, async (req, res) => {
    try {
        const result = await supportAdminService.updateTicketStatus(
            req.params.id,
            req.user.id,
            {
                status: req.body?.status,
                resolution: req.body?.resolution
            },
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "SUPPORT_TICKET_UPDATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// COMMISSION HOLDS
// ========================================

// Danh sách các khoản hoa hồng đang hoặc đã bị giữ
// GET /api/marketplace/admin/commission-holds
router.get("/commission-holds", canManageCommissions, async (req, res) => {
    try {
        const result = await commissionHoldAdminService.getCommissionHolds(
            req.query
        );

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Tạo yêu cầu giữ hoa hồng thủ công
// POST /api/marketplace/admin/commissions/:id/hold
router.post("/commissions/:id/hold", canManageCommissions, async (req, res) => {
    try {
        const result = await commissionHoldAdminService.createAdminHold(
            req.params.id,
            req.user.id,
            {
                reason: req.body?.reason
            },
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "COMMISSION_HOLD_CREATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Gỡ yêu cầu giữ hoa hồng do Admin tạo
// POST /api/marketplace/admin/commission-holds/:id/release
router.post(
    "/commission-holds/:id/release",
    canManageCommissions,
    async (req, res) => {
        try {
            const result = await commissionHoldAdminService.releaseAdminHold(
                req.params.id,
                req.user.id,
                {
                    releaseNote: req.body?.releaseNote
                },
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "COMMISSION_HOLD_RELEASED",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);
module.exports = router;
