
"use strict";
const fs = require("fs");

const express = require("express");
const path = require("path");

const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");

const payoutAdminService = require("../services/marketplace.payout.admin.service");
const payoutUpload = require("../middleware/marketplace.payout.upload");

const router = express.Router();

router.use(auth);

const canViewPayouts = requireContributorPermission("marketplace.payout.view");
const canManagePayouts = requireContributorPermission("marketplace.payout.manage");

const getAuditInfo = (req) => ({
  ipAddress: req.ip || null,
  userAgent: req.get("user-agent") || null
});

const errorMap = {
  INVALID_PAYOUT_ID: 400,
  INVALID_USER_ID: 400,
  INVALID_PAYOUT_STATUS: 400,
  PAYOUT_REQUEST_NOT_FOUND: 404,
  PAYOUT_NOT_FOUND: 404,
  PAYOUT_STATUS_INVALID: 409,
  PAYOUT_STATUS_CHANGED: 409,
  PAYOUT_ALREADY_PROCESSED: 409,
  PAYOUT_COMMISSION_STATE_CHANGED: 409,
  PAYOUT_COMMISSION_NOT_FOUND: 404,
  PAYOUT_COMMISSION_NOT_ELIGIBLE: 409,
  PAYOUT_COMMISSION_ON_HOLD: 409,
  PAYOUT_COMMISSION_HAS_ACTIVE_TICKET: 409,
  PAYOUT_ORDER_NOT_ELIGIBLE: 409,
  PAYOUT_TRANSACTION_REFERENCE_REQUIRED: 400,
  DUPLICATE_PAYOUT_TRANSACTION_REFERENCE: 409,
  INVALID_PAYOUT_AMOUNT: 400,
  INVALID_PAYOUT_PROOF_FILE_TYPE: 400,
  PAYOUT_PROOF_REQUIRED: 400,
  LIMIT_FILE_SIZE: 400,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
  PAYOUT_INVALID_STATUS_TRANSITION: 409,
  PAYOUT_TRANSACTION_REFERENCE_LOCK_FAILED: 409,
  PAYOUT_TRANSACTION_REFERENCE_DUPLICATE: 409,
  PAYOUT_ITEM_STATE_CHANGED: 409,
  PAYOUT_ITEMS_NOT_FOUND: 409,
  PAYOUT_TOTAL_MISMATCH: 409,
  PAYOUT_COMMISSION_PAYMENT_CONFLICT: 409,
  PAYOUT_ITEM_UPDATE_CONFLICT: 409,
  INVALID_ADMIN_USER_ID: 400,
  PAYOUT_ORDER_NOT_FOUND: 404,
  PAYOUT_REJECTION_REASON_REQUIRED: 400,
};

const handleError = (res, error) => {
  const code = error?.code || error?.message || "MARKETPLACE_PAYOUT_ADMIN_OPERATION_FAILED";
  const status = errorMap[code] || (code === "ER_DUP_ENTRY" ? 409 : 500);

  if (status === 500) {
    console.error("[MARKETPLACE PAYOUT ADMIN ERROR]", error);
  }

  return res.status(status).json({
    success: false,
    message: status === 500 ? "Đã xảy ra lỗi hệ thống" : code
  });
};

// GET /api/marketplace/admin/payouts
router.get("/payouts", canViewPayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.getPayoutList({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      sellerId: req.query.sellerId,
      keyword: req.query.keyword,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
});

// GET /api/marketplace/admin/payouts/:id
router.get("/payouts/:id", canViewPayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.getPayoutDetail(req.params.id);

    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/review
router.post("/payouts/:id/review", canManagePayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.reviewPayout(
      req.params.id,
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.json({
      success: true,
      message: "Đã tiếp nhận yêu cầu thanh toán.",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/approve
router.post("/payouts/:id/approve", canManagePayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.approvePayout(
      req.params.id,
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.json({
      success: true,
      message: "Đã duyệt yêu cầu thanh toán.",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/reject
router.post("/payouts/:id/reject", canManagePayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.rejectPayout(
      req.params.id,
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.json({
      success: true,
      message: "Đã từ chối yêu cầu thanh toán.",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/processing
router.post("/payouts/:id/processing", canManagePayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.markPayoutProcessing(
      req.params.id,
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.json({
      success: true,
      message: "Đã chuyển yêu cầu sang trạng thái đang thanh toán.",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/paid
router.post("/payouts/:id/paid", canManagePayouts, async (req, res) => {
  try {
    const result = await payoutAdminService.markPayoutPaid(
      req.params.id,
      req.user.id,
      req.body,
      getAuditInfo(req)
    );

    return res.json({
      success: true,
      message: "Đã xác nhận thanh toán thành công.",
      data: result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/marketplace/admin/payouts/:id/proof
router.post(
  "/payouts/:id/proof",
  canManagePayouts,
  (req, res, next) => {
    payoutUpload.upload.single("proof")(req, res, (error) => {
      if (error) return handleError(res, error);
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        const error = new Error("PAYOUT_PROOF_REQUIRED");
        return handleError(res, error);
      }

      const proofStorageKey = path.basename(req.file.filename);

      const result = await payoutAdminService.addPaymentProof(
        req.params.id,
        req.user.id,
        proofStorageKey,
        {
          note: req.body.note || null,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSize: req.file.size
        },
        getAuditInfo(req)
      );

      return res.json({
        success: true,
        message: "Đã tải bằng chứng thanh toán lên.",
        data: result
      });
        } catch (error) {
      if (req.file?.path) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      return handleError(res, error);
    }
  }
);

module.exports = router;
