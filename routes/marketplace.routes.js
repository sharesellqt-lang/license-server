
"use strict";

const express = require("express");
const auth = require("../middleware/auth");
const sellerService = require("../services/marketplace.seller.service");
const productService = require("../services/marketplace.product.service");
const requireContributorPermission = require("../middleware/requireContributorPermission");
const canViewProducts = requireContributorPermission("marketplace.product.view");
const canCreateProduct = requireContributorPermission("marketplace.product.create");
const canEditProduct = requireContributorPermission("marketplace.product.edit");
const canSubmitProduct = requireContributorPermission("marketplace.product.submit");

const router = express.Router();

router.use(auth);

function getAuditInfo(req) {
    return {
        ipAddress: req.ip || null,
        userAgent: req.get("user-agent") || null
    };
}

function handleError(res, error) {
    const code = error.message || "MARKETPLACE_OPERATION_FAILED";

    const errorMap = {
        INVALID_USER_ID: 400,
        INVALID_DISPLAY_NAME: 400,
        INVALID_INTRODUCTION: 400,
        INVALID_CONTACT_EMAIL: 400,
        INVALID_CONTACT_PHONE: 400,
        INVALID_SUPPORT_INFO: 400,
        SELLER_AGREEMENT_REQUIRED: 400,
        TARGET_USER_NOT_FOUND: 404,
        SELLER_NOT_FOUND: 404,
        SELLER_ALREADY_EXISTS: 409,
        SELLER_STATUS_INVALID: 409,
        SELLER_CANNOT_ACCEPT_AGREEMENT: 409,
        SELLER_CURRENT_AGREEMENT_NOT_ACCEPTED: 409,
        MARKETPLACE_AGREEMENT_NOT_AVAILABLE: 503,
        INVALID_TITLE: 400,
        INVALID_SHORT_DESCRIPTION: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_VERSION: 400,
        INVALID_REQUIREMENTS: 400,
        INVALID_COMPATIBILITY: 400,
        INVALID_LICENSE_TERMS: 400,
        INVALID_DOCUMENTATION: 400,
        INVALID_SUPPORT_POLICY: 400,
        INVALID_UPDATE_POLICY: 400,
        INVALID_REFUND_POLICY: 400,
        INVALID_PRODUCT_PRICE: 400,
        INVALID_PRODUCT_TYPE: 400,
        INVALID_PRODUCT_CURRENCY: 400,
        NO_PRODUCT_FIELDS_TO_UPDATE: 400,
        PRODUCT_INFORMATION_INCOMPLETE: 400,
        INVALID_USER_ID: 400,
        SELLER_NOT_FOUND: 404,
        PRODUCT_NOT_FOUND: 404,
        SELLER_NOT_ACTIVE: 403,
        PRODUCT_NOT_EDITABLE: 409,
        PRODUCT_CANNOT_BE_SUBMITTED: 409,
        PRODUCT_CANNOT_BE_ARCHIVED: 409
    };

    const status = errorMap[code] || (
        error.code === "ER_DUP_ENTRY" ? 409 : 500
    );

    if (status === 500) {
        console.error("[MARKETPLACE API ERROR]", error);
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
// SELLER: REGISTER
// POST /api/marketplace/seller/register
// ========================================

router.post("/seller/register", async (req, res) => {
    try {
        const result = await sellerService.registerSeller(
            req.user.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.status(201).json({
            success: true,
            message: "Đăng ký Seller thành công",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// SELLER: MY PROFILE
// GET /api/marketplace/seller/me
// ========================================

router.get("/seller/me", async (req, res) => {
    try {
        const result = await sellerService.getMySellerProfile(
            req.user.id
        );

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// SELLER: ACCEPT CURRENT AGREEMENT
// POST /api/marketplace/seller/accept-agreement
// ========================================

router.post("/seller/accept-agreement", async (req, res) => {
    try {
        const result = await sellerService.acceptCurrentAgreement(
            req.user.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã chấp nhận thỏa thuận Marketplace",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// SELLER: PRODUCTS
// ========================================

router.get("/seller/products", canViewProducts, async (req, res) => {
    try {
        const result = await productService.getMyProducts(
            req.user.id,
            req.query
        );

        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/seller/products/:id", canViewProducts, async (req, res) => {
    try {
        const result = await productService.getMyProductDetail(
            req.user.id,
            req.params.id
        );

        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/seller/products", canCreateProduct, async (req, res) => {
    try {
        const result = await productService.createProduct(
            req.user.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.status(201).json({
            success: true,
            message: "Đã tạo sản phẩm nháp",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.put("/seller/products/:id", canEditProduct, async (req, res) => {
    try {
        const result = await productService.updateProduct(
            req.user.id,
            req.params.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã cập nhật sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/seller/products/:id/submit", canSubmitProduct, async (req, res) => {
    try {
        const result = await productService.submitProduct(
            req.user.id,
            req.params.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã gửi sản phẩm để kiểm duyệt",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/seller/products/:id/archive", canEditProduct, async (req, res) => {
    try {
        const result = await productService.archiveProduct(
            req.user.id,
            req.params.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "Đã lưu trữ sản phẩm",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

module.exports = router;
