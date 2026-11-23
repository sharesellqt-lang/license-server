
"use strict";

const express = require("express");
const auth = require("../middleware/auth");
const sellerService = require("../services/marketplace.seller.service");

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
        MARKETPLACE_AGREEMENT_NOT_AVAILABLE: 503
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

module.exports = router;
