
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const productService = require("../services/affiliate.product.service");
const trackingService = require("../services/affiliate.tracking.service");

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

    return res.status(status).json({
        success: false,
        code: error.message || "AFFILIATE_OPERATION_FAILED",
        message: status === 500
            ? "Có lỗi xảy ra khi xử lý Affiliate"
            : error.message
    });
}

// Public redirect endpoint.
router.get("/go/:clickCode", async (req, res) => {
    try {
        const destination = await trackingService.getClickDestination(
            req.params.clickCode
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

// All endpoints below require authentication.
router.use(auth);

// Get active categories.
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

// Get active products.
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

// Get product detail.
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

// Create click and return internal redirect URL.
router.post("/click", async (req, res) => {
    try {
        const result = await trackingService.createClick(
            req.user.id,
            req.body.productId,
            {
                ip: req.ip,
                userAgent: req.get("user-agent")
            }
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

module.exports = router;
