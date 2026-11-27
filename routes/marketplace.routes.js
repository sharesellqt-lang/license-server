
"use strict";

const express = require("express");
const auth = require("../middleware/auth");
function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) {
        return res.status(403).json({
            success: false,
            error: "ADMIN_PERMISSION_REQUIRED"
        });
    }

    next();
}
const sellerService = require("../services/marketplace.seller.service");
const productService = require("../services/marketplace.product.service");
const requireContributorPermission = require("../middleware/requireContributorPermission");
const canViewProducts = requireContributorPermission("marketplace.product.view");
const canCreateProduct = requireContributorPermission("marketplace.product.create");
const canEditProduct = requireContributorPermission("marketplace.product.edit");
const canSubmitProduct = requireContributorPermission("marketplace.product.submit");
const productAssetService = require("../services/marketplace.product.asset.service");
const privateFileService = require("../services/marketplace.private-file.service");
const {
    upload,
    thumbnailUpload
} = require("../middleware/marketplace.product.upload");
const supportService = require("../services/marketplace.support.service");
const orderService = require("../services/marketplace.order.service");
const sellerBankService = require("../services/marketplace.seller.bank.service");
const payoutService = require("../services/marketplace.payout.service");
const commissionSellerService = require("../services/marketplace.commission.seller.service");
const sellerDashboardService = require("../services/marketplace.seller.dashboard.service");
const deliveryService = require("../services/marketplace.delivery.service");

const router = express.Router();

router.use(auth);

function getAuditInfo(req) {
    return {
        ipAddress: req.ip || null,
        userAgent: req.get("user-agent") || null
    };
}

// Admin cấp quyền giao hàng cho một order item chưa thanh toán
router.post("/admin/order-items/:orderItemId/delivery-authorization", requireAdmin, async (req, res) => {
    try {
        const result = await deliveryService.authorizeDelivery(
            req.user.id,
            req.params.orderItemId,
            (req.body || {}).reason
        );
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error);
    }
});

// Admin thu hồi quyền giao hàng
router.post("/admin/delivery-authorizations/:id/revoke", requireAdmin, async (req, res) => {
    try {
        const result = await deliveryService.revokeDeliveryAuthorization(
            req.user.id,
            req.params.id,
            req.body.reason
        );
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error);
    }
});
function getSellerRegistrationErrorCode(status) {
    const codes = {
        pending: "SELLER_APPLICATION_PENDING",
        active: "SELLER_ALREADY_ACTIVE",
        rejected: "SELLER_APPLICATION_REJECTED",
        suspended: "SELLER_ACCOUNT_SUSPENDED",
        closed: "SELLER_ACCOUNT_CLOSED"
    };

    return codes[status] || "SELLER_ALREADY_EXISTS";
}

function handleError(res, error) {
    let code = error.message || "MARKETPLACE_OPERATION_FAILED";

    if (code === "SELLER_ALREADY_EXISTS" && error.sellerStatus) {
        code = getSellerRegistrationErrorCode(error.sellerStatus);
    }

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
        PRODUCT_CANNOT_BE_ARCHIVED: 409,
        INVALID_PRODUCT_ID: 400,
        PRODUCT_FILE_REQUIRED: 400,
        INVALID_PRODUCT_FILE_ROLE: 400,
        INVALID_PRODUCT_FILE_TYPE: 400,
        PRODUCT_FILE_SIGNATURE_INVALID: 400,
        INVALID_DEMO_TYPE: 400,
        INVALID_DEMO_INFORMATION: 400,
        INVALID_DEMO_URL: 400,
        DEMO_FILE_TYPE_MISMATCH: 400,
        PRODUCT_FILE_NOT_FOUND: 404,
        PRODUCT_DEMO_NOT_FOUND: 404,
        PRODUCT_FILE_IN_USE_BY_DEMO: 409,
        PRODUCT_FILES_NOT_EDITABLE: 400,
        PRODUCT_DEMOS_NOT_EDITABLE: 409,
        PRODUCT_FILE_TOO_LARGE: 400,
        INVALID_FILE_ID: 400,
        PRIVATE_FILE_NOT_FOUND: 404,
        INVALID_TICKET_CATEGORY: 400,
        INVALID_TICKET_SUBJECT: 400,
        INVALID_TICKET_DESCRIPTION: 400,
        ORDER_NOT_OWNED: 403,
        INVALID_ID: 400,
        INVALID_BUYER: 400,
        INVALID_ORDER_ID: 400,
        INVALID_PRODUCT_ID: 400,
        INVALID_ORDER_ITEMS: 400,
        INVALID_PRODUCT_TYPE: 400,
        INVALID_PRODUCT_PRICE: 400,
        INVALID_ORDER_TOTAL: 400,
        UNSUPPORTED_CURRENCY: 400,
        DUPLICATE_ORDER_PRODUCT: 400,
        BUYER_NOT_FOUND: 404,
        PRODUCT_NOT_FOUND: 404,
        ORDER_NOT_FOUND: 404,
        PRODUCT_NOT_AVAILABLE: 409,
        CANNOT_BUY_OWN_PRODUCT: 409,
        // SELLER BANK ACCOUNTS
        INVALID_BANK_ACCOUNT_ID: 400,
        INVALID_BANK_NAME: 400,
        INVALID_BANK_CODE: 400,
        INVALID_BANK_ACCOUNT_NUMBER: 400,
        INVALID_BANK_ACCOUNT_HOLDER: 400,
        INVALID_BANK_BRANCH: 400,
        SELLER_BANK_ACCOUNT_NOT_FOUND: 404,
        SELLER_BANK_ACCOUNT_ALREADY_EXISTS: 409,
        SELLER_BANK_ACCOUNT_DISABLED: 409,
        SELLER_BANK_ACCOUNT_ALREADY_DISABLED: 409,
        SELLER_BANK_ACCOUNT_IN_ACTIVE_PAYOUT: 409,
        INVALID_PAYOUT_ID: 400,
        INVALID_COMMISSION_ID: 400,
        INVALID_PAYOUT_AMOUNT: 400,
        PAYOUT_COMMISSION_IDS_REQUIRED: 400,
        PAYOUT_TOO_MANY_COMMISSIONS: 400,
        DUPLICATE_PAYOUT_COMMISSION: 400,
        SELLER_NOT_ACTIVE: 403,
        PAYOUT_COMMISSION_NOT_FOUND: 404,
        PAYOUT_REQUEST_NOT_FOUND: 404,
        PAYOUT_COMMISSION_NOT_AVAILABLE: 409,
        PAYOUT_COMMISSION_NOT_ELIGIBLE: 409,
        PAYOUT_COMMISSION_NO_REMAINING_AMOUNT: 409,
        PAYOUT_CURRENCY_NOT_SUPPORTED: 409,
        PAYOUT_ORDER_NOT_FOUND: 404,
        PAYOUT_ORDER_NOT_ELIGIBLE: 409,
        PAYOUT_DELIVERY_NOT_COMPLETED: 409,
        PAYOUT_COMMISSION_ON_HOLD: 409,
        PAYOUT_COMMISSION_HAS_ACTIVE_TICKET: 409,
        PAYOUT_COMMISSION_ALREADY_REQUESTED: 409,
        PAYOUT_COMMISSION_STATE_CHANGED: 409,
        PAYOUT_REQUEST_DUPLICATE: 409,
        SELLER_NOT_FOUND: 404,
        SELLER_NOT_ACTIVE: 403,
        SELLER_BANK_ACCOUNT_NOT_FOUND: 404,
        INVALID_PAYOUT_REQUEST: 400,
        INVALID_PAYOUT_AMOUNT: 400,
        INVALID_PAYOUT_COMMISSION: 400,
        PAYOUT_COMMISSION_NOT_AVAILABLE: 409,
        PAYOUT_COMMISSION_NOT_ELIGIBLE: 409,
        PAYOUT_COMMISSION_ON_HOLD: 409,
        PAYOUT_COMMISSION_ALREADY_REQUESTED: 409,
        PAYOUT_ORDER_NOT_ELIGIBLE: 409,
        PAYOUT_SUPPORT_TICKET_ACTIVE: 409,
        PAYOUT_REQUEST_NOT_FOUND: 404,
        INVALID_PAYOUT_STATUS: 400,
        INVALID_PAYOUT_REQUEST: 400,
        PAYOUT_COMMISSION_NO_REMAINING_AMOUNT: 409,
        PAYOUT_COMMISSION_STATE_CHANGED: 409,
        PAYOUT_REQUEST_DUPLICATE: 409,
        PAYOUT_SUPPORT_TICKET_ACTIVE: 409,
        PAYOUT_COMMISSION_ALREADY_REQUESTED: 409,
        INVALID_AGREEMENT_ID: 400,
        SELLER_AGREEMENT_CHANGED: 409,
        INVALID_AGREEMENT_ID: 400,
        SELLER_AGREEMENT_CHANGED: 409,
        SELLER_AGREEMENT_REQUIRED: 400,
        INVALID_SELLER_DATA: 400,
        INVALID_AGREEMENT_ID: 400,
        SELLER_AGREEMENT_CHANGED: 409,
        SELLER_AGREEMENT_REQUIRED: 400,

        SELLER_ALREADY_EXISTS: 409,
        SELLER_APPLICATION_PENDING: 409,
        SELLER_ALREADY_ACTIVE: 409,
        SELLER_APPLICATION_REJECTED: 409,
        SELLER_ACCOUNT_SUSPENDED: 409,
        SELLER_ACCOUNT_CLOSED: 409,
        INVALID_SELLER_DATA: 400,
        INVALID_AGREEMENT_ID: 400,
        SELLER_AGREEMENT_CHANGED: 409,
        SELLER_AGREEMENT_REQUIRED: 400,
        SELLER_ALREADY_EXISTS: 409,
        SELLER_APPLICATION_PENDING: 409,
        SELLER_ALREADY_ACTIVE: 409,
        SELLER_APPLICATION_REJECTED: 409,
        SELLER_ACCOUNT_SUSPENDED: 409,
        SELLER_ACCOUNT_CLOSED: 409,
        INVALID_SELLER_ID: 400,
        INVALID_REVIEW_NOTE: 400,
        SELLER_REOPEN_STATUS_INVALID: 409,
        SELLER_STATUS_INVALID: 409,
        SELLER_NOT_FOUND: 404,
        INVALID_ORDER_STATUS: 400,
        INVALID_SEARCH: 400,
        // SELLER DELIVERIES
        INVALID_DELIVERY_FILES: 400,
        DUPLICATE_DELIVERY_FILES: 400,
        DELIVERY_NOTE_TOO_LONG: 400,
        ACCESS_URL_TOO_LONG: 400,
        INSTRUCTIONS_TOO_LONG: 400,
        DELIVERY_DATA_TOO_LONG: 400,
        CHANGE_REASON_TOO_LONG: 400,
        CHANGE_REASON_REQUIRED: 400,
        REDELIVERY_REASON_REQUIRED: 400,
        INVALID_DELIVERY_STATUS: 400,
        INVALID_MARKETPLACE_SETTINGS: 500,
        INVALID_MARKETPLACE_COMMISSION_SETTINGS: 500,
        INVALID_COMMISSION_AMOUNT: 400,
        INVALID_AUTHORIZATION_REASON: 400,
        INVALID_REVOCATION_REASON: 400,
        INVALID_CONFIRMATION_METHOD: 400,

        DELIVERY_NOT_FOUND: 404,
        ORDER_ITEM_NOT_FOUND: 404,

        DELIVERY_ALREADY_EXISTS: 409,
        DELIVERY_NOT_OWNED: 403,
        ORDER_ITEM_NOT_OWNED: 403,
        BUYER_NOT_AUTHORIZED: 403,
        ORDER_NOT_PAID: 409,
        ORDER_NOT_DELIVERABLE: 409,
        DELIVERY_NOT_EDITABLE: 409,
        DELIVERY_NOT_CONFIRMABLE: 409,
        ACTIVE_SUPPORT_TICKET: 409,
        AUTO_CONFIRM_NOT_DUE: 409,
        DELIVERY_AUTHORIZATION_ALREADY_USED: 409,
        ACTIVE_AUTHORIZATION_EXISTS: 409,
        AUTHORIZATION_NOT_REVOCABLE: 409,
        ORDER_ALREADY_PAID: 409,
        ORDER_ALREADY_PAID: 409,
        PRIVATE_FILE_NOT_FOUND: 404,
        INVALID_FILE_ID: 400,
        // MARKETPLACE SUPPORT
        INVALID_TICKET_STATUS: 400,
        INVALID_TICKET_MESSAGE: 400,
        INVALID_TICKET_MESSAGE_TYPE: 400,
        INVALID_TICKET_RESOLUTION: 400,
        SUPPORT_TICKET_NOT_FOUND: 404,
        SUPPORT_TICKET_NOT_OWNED: 403,
        SUPPORT_TICKET_ALREADY_CLOSED: 409,
        SUPPORT_TICKET_STATUS_INVALID: 409,
        SUPPORT_TICKET_MESSAGE_NOT_ALLOWED: 409,
        INVALID_TICKET_MESSAGE: 400,
        SUPPORT_TICKET_NOT_FOUND: 404,
        SUPPORT_TICKET_MESSAGE_NOT_ALLOWED: 409,
        INVALID_COMMISSION_STATUS: 400,
        INVALID_COMMISSION_PAYOUT_METHOD: 400,
        INVALID_COMMISSION_DATE_FILTER: 400,
        COMMISSION_NOT_FOUND: 404,
        INVALID_PRODUCT_THUMBNAIL_TYPE: 400,
        PRODUCT_THUMBNAIL_TOO_LARGE: 400,
        PRODUCT_FILE_SIGNATURE_INVALID: 400,
        PRODUCT_THUMBNAIL_NOT_FOUND: 404,
        USE_PRODUCT_THUMBNAIL_ENDPOINT: 400,
        PRODUCT_FILES_NOT_EDITABLE: 400,
                
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


function uploadProductFile(req, res, next) {
    upload.single("file")(req, res, error => {
        if (!error) return next();

        const code = error.code === "LIMIT_FILE_SIZE"
            ? "PRODUCT_FILE_TOO_LARGE"
            : error.message === "INVALID_PRODUCT_FILE_TYPE"
                ? "INVALID_PRODUCT_FILE_TYPE"
                : "PRODUCT_UPLOAD_FAILED";

        const status = code === "PRODUCT_UPLOAD_FAILED" ? 500 : 400;

        return res.status(status).json({
            success: false,
            code,
            message: status === 500
                ? "Không thể tải file lên"
                : code
        });
    });
}

function uploadProductThumbnail(req, res, next) {
    thumbnailUpload.single("file")(req, res, error => {
        if (!error) return next();

        const code = error.code === "LIMIT_FILE_SIZE"
            ? "PRODUCT_THUMBNAIL_TOO_LARGE"
            : error.message === "INVALID_PRODUCT_THUMBNAIL_TYPE"
                ? "INVALID_PRODUCT_THUMBNAIL_TYPE"
                : "PRODUCT_UPLOAD_FAILED";

        const status = code === "PRODUCT_UPLOAD_FAILED" ? 500 : 400;

        return res.status(status).json({
            success: false,
            code,
            message: status === 500
                ? "Không thể tải ảnh thumbnail lên"
                : code
        });
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
        // Bổ sung trạng thái nếu lỗi duplicate key không mang theo status.
        if (
            error.message === "SELLER_ALREADY_EXISTS" &&
            !error.sellerStatus
        ) {
            try {
                const profile = await sellerService.getMySellerProfile(
                    req.user.id
                );

                error.sellerStatus = profile?.status || null;
            } catch (lookupError) {
                console.error(
                    "[SELLER REGISTER] Lookup existing Seller:",
                    lookupError
                );
            }
        }

        return handleError(res, error);
    }
});


router.get("/seller/agreement/current", async (req, res) => {
    try {
        const result = await sellerService.getCurrentAgreement(req.user.id);

        return res.json({
            success: true,
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
// SELLER: DASHBOARD
// GET /api/marketplace/seller/dashboard
// ========================================

router.get("/seller/dashboard", async (req, res) => {
    try {
        const result = await sellerDashboardService.getSellerDashboard(
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
// SELLER: CUSTOMER SUPPORT
// ========================================

// Danh sách ticket của Seller
router.get("/seller/support-tickets", async (req, res) => {
    try {
        const result = await supportService.getSellerTickets(
            req.user.id,
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

// Chi tiết ticket và hội thoại
router.get("/seller/support-tickets/:id", async (req, res) => {
    try {
        const result = await supportService.getSellerTicketDetail(
            req.user.id,
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

// Seller phản hồi hoặc ghi chú nội bộ
router.post("/seller/support-tickets/:id/messages", async (req, res) => {
    try {
        const result = await supportService.createSellerMessage(
            req.user.id,
            req.params.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.status(201).json({
            success: true,
            message: "SUPPORT_MESSAGE_CREATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Seller tiếp nhận hoặc chuyển ticket sang chờ Buyer
router.put("/seller/support-tickets/:id/status", async (req, res) => {
    try {
        const result = await supportService.updateSellerTicketStatus(
            req.user.id,
            req.params.id,
            req.body || {},
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


router.get(
    "/buyer/support-tickets",
    async (req, res) => {
        try {
            const result = await supportService.getBuyerTickets(
                req.user.id,
                req.query
            );

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            handleError(res, error);
        }
    }
);

router.get(
    "/buyer/support-tickets/:id",
    async (req, res) => {
        try {
            const result = await supportService.getBuyerTicketDetail(
                req.user.id,
                req.params.id
            );

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            handleError(res, error);
        }
    }
);

router.post(
    "/buyer/support-tickets/:id/messages",
    async (req, res) => {
        try {
            const result = await supportService.createBuyerMessage(
                req.user.id,
                req.params.id,
                {
                    message: req.body?.message
                }
            );

            return res.status(201).json({
                success: true,
                message: "SUPPORT_MESSAGE_CREATED",
                data: result
            });
        } catch (error) {
            handleError(res, error);
        }
    }
);

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

// ========================================
// SELLER: PRODUCT THUMBNAIL
// ========================================

// Upload hoặc thay thế ảnh thumbnail.
router.post(
    "/seller/products/:id/thumbnail",
    canEditProduct,
    uploadProductThumbnail,
    async (req, res) => {
        try {
            const result = await productAssetService.replaceProductThumbnail(
                req.user.id,
                req.params.id,
                req.file,
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                message: "Đã cập nhật ảnh thumbnail sản phẩm",
                data: result
            });
        } catch (error) {
            if (req.file) {
                await productAssetService.removeFile(req.file.filename);
            }

            return handleError(res, error);
        }
    }
);

// Xóa ảnh thumbnail hiện tại.
router.delete(
    "/seller/products/:id/thumbnail",
    canEditProduct,
    async (req, res) => {
        try {
            const result = await productAssetService.deleteProductThumbnail(
                req.user.id,
                req.params.id,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã xóa ảnh thumbnail sản phẩm",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);
// ========================================
// SELLER: PRODUCT FILES
// ========================================

// Upload product file
router.post(
    "/seller/products/:id/files",
    canEditProduct,
    uploadProductFile,
    async (req, res) => {
        try {
            const result = await productAssetService.attachProductFile(
                req.user.id,
                req.params.id,
                req.file,
                req.body.fileRole,
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                message: "Đã tải file lên",
                data: result
            });
        } catch (error) {
            if (req.file) {
                await productAssetService.removeFile(req.file.filename);
            }

            return handleError(res, error);
        }
    }
);

// List product files
router.get(
    "/seller/products/:id/files",
    canViewProducts,
    async (req, res) => {
        try {
            const result = await productAssetService.getMyProductFiles(
                req.user.id,
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

// Delete product file
router.delete(
    "/seller/products/:id/files/:fileId",
    canEditProduct,
    async (req, res) => {
        try {
            const result = await productAssetService.deleteProductFile(
                req.user.id,
                req.params.id,
                req.params.fileId,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã xóa file sản phẩm",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// ========================================
// SELLER: PRODUCT DEMOS
// ========================================

// List product demos
router.get(
    "/seller/products/:id/demos",
    canViewProducts,
    async (req, res) => {
        try {
            const result = await productAssetService.getMyProductDemos(
                req.user.id,
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

// Create product demo
router.post(
    "/seller/products/:id/demos",
    canEditProduct,
    async (req, res) => {
        try {
            const result = await productAssetService.saveProductDemo(
                req.user.id,
                req.params.id,
                req.body || {},
                null,
                getAuditInfo(req)
            );

            return res.status(201).json({
                success: true,
                message: "Đã thêm demo sản phẩm",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// Update product demo
router.put(
    "/seller/products/:id/demos/:demoId",
    canEditProduct,
    async (req, res) => {
        try {
            const result = await productAssetService.saveProductDemo(
                req.user.id,
                req.params.id,
                req.body || {},
                req.params.demoId,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã cập nhật demo sản phẩm",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// Delete product demo
router.delete(
    "/seller/products/:id/demos/:demoId",
    canEditProduct,
    async (req, res) => {
        try {
            const result = await productAssetService.deleteProductDemo(
                req.user.id,
                req.params.id,
                req.params.demoId,
                getAuditInfo(req)
            );

            return res.json({
                success: true,
                message: "Đã xóa demo sản phẩm",
                data: result
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// Seller tải file thuộc sản phẩm của mình.
router.get(
    "/seller/products/:id/files/:fileId/download",
    canViewProducts,
    async (req, res) => {
        try {
            const file = await privateFileService.getSellerProductFile(
                req.user.id,
                req.params.id,
                req.params.fileId
            );

            await privateFileService.sendPrivateFile(res, file, {
                download: true
            });
        } catch (error) {
            if (res.headersSent) return res.destroy();
            handleError(res, error);
        }
    }
);



// Buyer tải file đã được gắn với lần giao hàng của chính mình.
router.get(
    "/buyer/deliveries/:deliveryId/files/:fileId/download",
    async (req, res) => {
        try {
            const file = await privateFileService.getBuyerDeliveryFile(
                req.user.id,
                req.params.deliveryId,
                req.params.fileId
            );

            await privateFileService.sendPrivateFile(res, file, {
                download: true
            });
        } catch (error) {
            if (res.headersSent) return res.destroy();
            handleError(res, error);
        }
    }
);

router.post(
    "/buyer/order-items/:orderItemId/support-tickets",
    async (req, res) => {
        try {
            const result = await supportService.createBuyerTicket(
                req.user.id,
                req.params.orderItemId,
                {
                    category: req.body.category,
                    subject: req.body.subject,
                    description: req.body.description
                }
            );

            return res.status(201).json({
                success: true,
                message: "SUPPORT_TICKET_CREATED",
                data: result
            });
        } catch (error) {
            handleError(res, error);
        }
    }
);

// ========================================
// BUYER: CHECKOUT
// ========================================

router.post("/orders", async (req, res) => {
    try {
        const result = await orderService.createOrder(
            req.user.id,
            req.body
        );

        return res.status(201).json({
            success: true,
            message: "Tạo đơn hàng thành công.",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// BUYER: MY ORDERS
// ========================================

router.get("/buyer/orders", async (req, res) => {
    try {
        const result = await orderService.getBuyerOrders(
            req.user.id,
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

router.get("/buyer/orders/:id", async (req, res) => {
    try {
        const result = await orderService.getBuyerOrderDetail(
            req.user.id,
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


// ==========================================
// SELLER BANK ACCOUNTS
// ==========================================

router.get("/seller/bank-accounts", async (req, res) => {
    try {
        const result = await sellerBankService.getMyBankAccounts(req.user.id);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});


router.post("/seller/bank-accounts", async (req, res) => {
    try {
        const result = await sellerBankService.createBankAccount(
            req.user.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.status(201).json({
            success: true,
            message: "SELLER_BANK_ACCOUNT_CREATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.put("/seller/bank-accounts/:id", async (req, res) => {
    try {
        const result = await sellerBankService.updateBankAccount(
            req.user.id,
            req.params.id,
            req.body || {},
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "SELLER_BANK_ACCOUNT_UPDATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.patch("/seller/bank-accounts/:id/default", async (req, res) => {
    try {
        const result = await sellerBankService.setDefaultBankAccount(
            req.user.id,
            req.params.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "SELLER_BANK_ACCOUNT_DEFAULT_UPDATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.delete("/seller/bank-accounts/:id", async (req, res) => {
    try {
        const result = await sellerBankService.disableBankAccount(
            req.user.id,
            req.params.id,
            getAuditInfo(req)
        );

        return res.json({
            success: true,
            message: "SELLER_BANK_ACCOUNT_DISABLED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});


// ==================== SELLER COMMISSIONS ====================

// Thống kê hoa hồng của Seller đang đăng nhập
router.get("/seller/commissions/statistics", async (req, res) => {
  try {
    const result = await commissionSellerService.getCommissionStatistics(
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

// Lấy danh sách hoa hồng của Seller đang đăng nhập
router.get("/seller/commissions", async (req, res) => {
  try {
    const result = await commissionSellerService.getCommissions(
      req.user.id,
      {
        page: req.query.page,
        limit: req.query.limit,
        status: req.query.status,
        payout_method: req.query.payout_method,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        search: req.query.search
      }
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// Lấy chi tiết hoa hồng của Seller đang đăng nhập
router.get("/seller/commissions/:id", async (req, res) => {
  try {
    const result = await commissionSellerService.getCommissionDetail(
      req.user.id,
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


// ==================== SELLER PAYOUT ====================

// Lấy danh sách yêu cầu thanh toán
router.get("/seller/payouts", async (req, res) => {
  try {
    const result = await payoutService.getMyPayouts(
      req.user.id,
      {
        page: req.query.page,
        limit: req.query.limit,
        status: req.query.status
      }
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// Lấy chi tiết yêu cầu thanh toán
router.get("/seller/payouts/:id", async (req, res) => {
  try {
    const result = await payoutService.getMyPayoutDetail(
      req.user.id,
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

// Tạo yêu cầu thanh toán
router.post("/seller/payouts", async (req, res) => {
  try {
    const result = await payoutService.createPayoutRequest(
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.status(201).json({
      success: true,
      message: "PAYOUT_REQUEST_CREATED",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// ========================================
// SELLER: MY ORDERS
// ========================================

router.get("/seller/orders", async (req, res) => {
    try {
        const result = await orderService.getSellerOrders(
            req.user.id,
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

router.get("/seller/orders/:id", async (req, res) => {
    try {
        const result = await orderService.getSellerOrderDetail(
            req.user.id,
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


// ========================================
// SELLER: DELIVERIES
// ========================================

// Danh sách bàn giao
router.get("/seller/deliveries", async (req, res) => {
    try {
        const result = await deliveryService.getSellerDeliveries(
            req.user.id,
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

// Chi tiết bàn giao và lịch sử phiên bản
router.get("/seller/deliveries/:id", async (req, res) => {
    try {
        const result = await deliveryService.getSellerDeliveryDetail(
            req.user.id,
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

// Tạo bàn giao lần đầu cho order item
router.post("/seller/order-items/:orderItemId/delivery", async (req, res) => {
    try {
        const result = await deliveryService.createDelivery(
            req.user.id,
            req.params.orderItemId,
            req.body || {}
        );

        return res.status(201).json({
            success: true,
            message: "DELIVERY_CREATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Cập nhật nội dung bằng phiên bản mới
router.put("/seller/deliveries/:id", async (req, res) => {
    try {
        const result = await deliveryService.updateDelivery(
            req.user.id,
            req.params.id,
            req.body || {}
        );

        return res.json({
            success: true,
            message: "DELIVERY_VERSION_CREATED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// Bàn giao lại
router.post("/seller/deliveries/:id/redeliver", async (req, res) => {
    try {
        const result = await deliveryService.redeliver(
            req.user.id,
            req.params.id,
            req.body || {}
        );

        return res.json({
            success: true,
            message: "DELIVERY_REDELIVERED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// ========================================
// BUYER: DELIVERY CONFIRMATION
// ========================================

router.post("/buyer/deliveries/:deliveryId/confirm", async (req, res) => {
    try {
        const result = await deliveryService.confirmDelivery(
            req.params.deliveryId,
            req.user.id,
            "buyer"
        );

        return res.json({
            success: true,
            message: "DELIVERY_CONFIRMED",
            data: result
        });
    } catch (error) {
        return handleError(res, error);
    }
});


// Buyer: xem chi tiết giao hàng và lịch sử phiên bản
router.get("/buyer/deliveries/:deliveryId", async (req, res) => {
    try {
        const result = await deliveryService.getBuyerDeliveryDetail(
            req.user.id,
            req.params.deliveryId
        );

        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error);
    }
});

// Buyer: tải file theo phiên bản giao hàng
router.get(
    "/buyer/deliveries/:deliveryId/versions/:versionId/files/:fileId/download",
    async (req, res) => {
        try {
            const file = await privateFileService.getBuyerDeliveryVersionFile(
                req.user.id,
                req.params.deliveryId,
                req.params.versionId,
                req.params.fileId
            );

            return await privateFileService.sendPrivateFile(
                res,
                file,
                { download: true }
            );
        } catch (error) {
            if (res.headersSent) return;
            return handleError(res, error);
        }
    }
);


// Seller tải file thuộc lần bàn giao hiện tại.
router.get(
    "/seller/deliveries/:deliveryId/files/:fileId/download",
    async (req, res) => {
        try {
            const file = await privateFileService.getSellerDeliveryFile(
                req.user.id,
                req.params.deliveryId,
                req.params.fileId
            );

            return await privateFileService.sendPrivateFile(
                res,
                file,
                { download: true }
            );
        } catch (error) {
            if (res.headersSent) return res.destroy();
            return handleError(res, error);
        }
    }
);

// Seller tải file thuộc một phiên bản bàn giao.
router.get(
    "/seller/deliveries/:deliveryId/versions/:versionId/files/:fileId/download",
    async (req, res) => {
        try {
            const file = await privateFileService.getSellerDeliveryVersionFile(
                req.user.id,
                req.params.deliveryId,
                req.params.versionId,
                req.params.fileId
            );

            return await privateFileService.sendPrivateFile(
                res,
                file,
                { download: true }
            );
        } catch (error) {
            if (res.headersSent) return res.destroy();
            return handleError(res, error);
        }
    }
);


module.exports = router;
