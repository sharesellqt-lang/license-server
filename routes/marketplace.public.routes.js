
"use strict";

const express = require("express");
const orderService = require("../services/marketplace.order.service");
const privateFileService = require("../services/marketplace.private-file.service");
const settingsAdminService = require("../services/marketplace.settings.admin.service");

const router = express.Router();

function handlePublicError(res, error) {
    const code = error.message || "MARKETPLACE_OPERATION_FAILED";

const errorMap = {
    INVALID_PRODUCT_ID: 400,
    PRODUCT_NOT_FOUND: 404,
    PRODUCT_DEMO_NOT_FOUND: 404,
    PRIVATE_FILE_NOT_FOUND: 404,
    PRODUCT_FILE_NOT_FOUND: 404,
    PRODUCT_FILE_NOT_SCANNED_CLEAN: 409
};

    const status = errorMap[code] || 500;

    if (status === 500) {
        console.error("[MARKETPLACE PUBLIC API ERROR]", error);
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
// PUBLIC: PAYMENT BANK ACCOUNT
// GET /api/marketplace/payment/bank-account
// ========================================

router.get("/payment/bank-account", async (req, res) => {
    try {
        const result = await settingsAdminService.getPublicPaymentBankAccount();

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handlePublicError(res, error);
    }
});

// ========================================
// PUBLIC: PRODUCT THUMBNAIL
// GET /api/marketplace/products/:id/thumbnail
// ========================================

router.get("/products/:id/thumbnail", async (req, res) => {
    try {
        const file = await privateFileService.getPublicProductThumbnail(
            req.params.id
        );

await privateFileService.sendPrivateFile(res, file, {
    download: false
});
    } catch (error) {
        if (res.headersSent) return res.destroy();
        return handlePublicError(res, error);
    }
});
// ========================================
// PUBLIC: PRODUCT DEMO FILE
// GET /api/marketplace/products/:id/demos/:demoId/file
// ========================================

router.get("/products/:id/demos/:demoId/file", async (req, res) => {
    try {
        const file = await privateFileService.getPublicDemoFile(
            req.params.id,
            req.params.demoId
        );

        await privateFileService.sendPrivateFile(res, file, {
            download: false
        });
    } catch (error) {
        if (res.headersSent) return res.destroy();
        return handlePublicError(res, error);
    }
});

// ========================================
// PUBLIC: PRODUCT CATALOG
// ========================================

router.get("/products", async (req, res) => {
    try {
        const result = await orderService.getPublishedProducts(req.query);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handlePublicError(res, error);
    }
});

router.get("/products/:id", async (req, res) => {
    try {
        const result = await orderService.getPublishedProductDetail(
            req.params.id
        );

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handlePublicError(res, error);
    }
});

module.exports = router;
