
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const { upload, uploadDir } = require("../middleware/marketplace.receipt.upload");
const { sendReceiptFile } = require("../services/marketplace.receipt.service");

const router = express.Router();

router.use(auth);

const MAX_REFERENCE_LENGTH = 150;

async function removeUploadedFile(file) {
  if (!file?.path) return;

  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("MARKETPLACE RECEIPT CLEANUP ERROR:", err.message);
    }
  }
}

async function validateFileSignature(file) {
  const handle = await fs.promises.open(file.path, "r");

  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    const data = buffer.subarray(0, bytesRead);

    switch (file.mimetype) {
      case "image/jpeg":
        return data.length >= 3 &&
          data[0] === 0xff &&
          data[1] === 0xd8 &&
          data[2] === 0xff;

      case "image/png":
        return data.length >= 8 &&
          data.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          );

      case "image/webp":
        return data.length >= 12 &&
          data.toString("ascii", 0, 4) === "RIFF" &&
          data.toString("ascii", 8, 12) === "WEBP";

      case "application/pdf":
        return data.length >= 5 &&
          data.toString("ascii", 0, 5) === "%PDF-";

      default:
        return false;
    }
  } finally {
    await handle.close();
  }
}

// Buyer uploads bank transfer receipt for their own order.

router.post("/orders/:orderId/payment/receipt", (req, res) => {
  upload.single("receipt")(req, res, async (uploadError) => {
    if (uploadError) {
      const isSizeError = uploadError.code === "LIMIT_FILE_SIZE";
      const isTypeError = uploadError.message === "INVALID_RECEIPT_TYPE";

      return res.status(400).json({
        success: false,
        message: isSizeError
          ? "Biên lai không được vượt quá 5 MB."
          : isTypeError
            ? "Chỉ chấp nhận JPEG, PNG, WebP hoặc PDF."
            : "Không thể tải biên lai lên."
      });
    }

    const file = req.file;

    let conn;
    let oldReceiptKey = null;
    let committed = false;

    try {
      const orderId = Number(req.params.orderId);
      const buyerUserId = Number(req.user.id);

      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Mã đơn hàng không hợp lệ."
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng chọn file biên lai."
        });
      }

      const transactionReference = String(
        req.body.transactionReference || ""
      ).trim();

      if (transactionReference.length > MAX_REFERENCE_LENGTH) {
        return res.status(400).json({
          success: false,
          message: "Mã giao dịch không được vượt quá 150 ký tự."
        });
      }

      const validSignature = await validateFileSignature(file);

      if (!validSignature) {
        return res.status(400).json({
          success: false,
          message: "Nội dung file không đúng định dạng khai báo."
        });
      }

      conn = await db.getConnection();
      await conn.beginTransaction();

      // Lock order first to prevent concurrent submissions.
      const [orders] = await conn.execute(
        `SELECT id, buyer_user_id, payment_status, order_status,
          payment_deadline_at,
          payment_deadline_at > NOW() AS deadline_valid
         FROM marketplace_orders
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderId]
      );

      if (!orders.length) {
        await conn.rollback();

        return res.status(404).json({
          success: false,
          message: "Không tìm thấy đơn hàng."
        });
      }

      const order = orders[0];

      if (Number(order.buyer_user_id) !== buyerUserId) {
        await conn.rollback();

        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền tải biên lai cho đơn hàng này."
        });
      }

      // Reject new receipt submissions after payment deadline.
      if (
        !order.payment_deadline_at ||
        !Number(order.deadline_valid)
      ) {
        await conn.rollback();

        return res.status(410).json({
          success: false,
          code: "PAYMENT_DEADLINE_EXPIRED",
          message: "Đã hết hạn thanh toán. Không thể gửi biên lai mới."
        });
      }

      if (
        !["pending", "processing"].includes(order.payment_status) ||
        !["pending_payment", "processing"].includes(order.order_status)
      ) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          message: "Đơn hàng không còn ở trạng thái chờ thanh toán."
        });
      }

      const [payments] = await conn.execute(
        `SELECT id, payment_method, status, receipt_storage_key
         FROM marketplace_order_payments
         WHERE order_id = ?
           AND status IN ('pending', 'processing')
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [orderId]
      );

      if (!payments.length) {
        await conn.rollback();

        return res.status(404).json({
          success: false,
          message: "Không tìm thấy khoản thanh toán đang chờ xử lý."
        });
      }

      const payment = payments[0];

      if (payment.payment_method !== "bank_transfer") {
        await conn.rollback();

        return res.status(400).json({
          success: false,
          message: "Khoản thanh toán này không sử dụng chuyển khoản ngân hàng."
        });
      }

      oldReceiptKey = payment.receipt_storage_key;

      await conn.execute(
        `UPDATE marketplace_order_payments
         SET transaction_reference = ?,
             receipt_storage_key = ?,
             submitted_at = NOW(),
             status = 'processing'
         WHERE id = ?`,
        [
          transactionReference || null,
          file.filename,
          payment.id
        ]
      );

      await conn.execute(
        `UPDATE marketplace_orders
         SET payment_status = 'processing'
         WHERE id = ?`,
        [orderId]
      );

      await conn.commit();
      committed = true;

      // Remove replaced receipt only after successful commit.
      if (oldReceiptKey && oldReceiptKey !== file.filename) {
        const oldPath = path.join(
          uploadDir,
          path.basename(oldReceiptKey)
        );

        try {
          await fs.promises.unlink(oldPath);
        } catch (err) {
          if (err.code !== "ENOENT") {
            console.error(
              "OLD RECEIPT CLEANUP ERROR:",
              err.message
            );
          }
        }
      }

      return res.json({
        success: true,
        message: "Đã gửi biên lai. Thanh toán đang chờ Finance xác minh.",
        data: {
          orderId,
          paymentId: payment.id,
          paymentStatus: "processing",
          submittedAt: new Date().toISOString()
        }
      });

    } catch (err) {
      if (conn && !committed) {
        try {
          await conn.rollback();
        } catch (_) {}
      }

      console.error("MARKETPLACE RECEIPT UPLOAD ERROR:", err);

      return res.status(500).json({
        success: false,
        message: "Không thể gửi biên lai. Vui lòng thử lại."
      });

    } finally {
      if (conn) conn.release();

      if (!committed) {
        await removeUploadedFile(file);
      }
    }
  });
});


// Buyer can view receipt only when the payment belongs to their own order.
router.get("/payments/:id/receipt", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const buyerUserId = Number(req.user.id);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment ID không hợp lệ."
      });
    }

    const [rows] = await db.execute(
      `SELECT p.receipt_storage_key
       FROM marketplace_order_payments p
       INNER JOIN marketplace_orders o ON o.id = p.order_id
       WHERE p.id = ?
         AND o.buyer_user_id = ?
       LIMIT 1`,
      [paymentId, buyerUserId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khoản thanh toán."
      });
    }

    return sendReceiptFile(res, rows[0].receipt_storage_key);

  } catch (err) {
    console.error("BUYER RECEIPT ACCESS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Không thể xem biên lai."
    });
  }
});


// Buyer creates a new bank-transfer attempt after the previous attempt failed.
router.post("/orders/:orderId/payment/attempt", async (req, res) => {
  let conn;
  let committed = false;

  try {
    const orderId = Number(req.params.orderId);
    const buyerUserId = Number(req.user.id);

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Mã đơn hàng không hợp lệ."
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Lock order to serialize concurrent payment-attempt requests.
    const [orders] = await conn.execute(
      `SELECT id, buyer_user_id, total_amount, currency,
              payment_status, order_status,
              payment_deadline_at,
              payment_deadline_at > NOW() AS deadline_valid
       FROM marketplace_orders
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId]
    );

    if (!orders.length) {
      await conn.rollback();

      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng."
      });
    }

    const order = orders[0];

    if (Number(order.buyer_user_id) !== buyerUserId) {
      await conn.rollback();

      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền tạo thanh toán cho đơn hàng này."
      });
    }

    if (
      order.payment_status !== "pending" ||
      order.order_status !== "pending_payment"
    ) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Đơn hàng không ở trạng thái cho phép thanh toán lại."
      });
    }

    if (!order.payment_deadline_at || !Number(order.deadline_valid)) {
      await conn.rollback();

      return res.status(410).json({
        success: false,
        code: "PAYMENT_DEADLINE_EXPIRED",
        message: "Đơn hàng đã hết hạn thanh toán hoặc không có thời hạn hợp lệ."
      });
    }

    // Lock and inspect previous attempts.
    const [previousPayments] = await conn.execute(
      `SELECT id, status
       FROM marketplace_order_payments
       WHERE order_id = ?
       ORDER BY id DESC
       FOR UPDATE`,
      [orderId]
    );

    if (!previousPayments.length) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Đơn hàng chưa có khoản thanh toán trước đó."
      });
    }

    const latestPayment = previousPayments[0];

    if (latestPayment.status !== "failed") {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Chỉ được tạo lần thanh toán mới sau khi lần trước bị từ chối."
      });
    }

    const activePayment = previousPayments.find(
      payment => ["pending", "processing"].includes(payment.status)
    );

    if (activePayment) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Đơn hàng đang có một khoản thanh toán chờ xử lý."
      });
    }

    const [result] = await conn.execute(
      `INSERT INTO marketplace_order_payments
       (
         order_id,
         payment_method,
         amount,
         currency,
         status,
         provider
       )
       VALUES (?, 'bank_transfer', ?, ?, 'pending', 'manual_bank_transfer')`,
      [
        orderId,
        order.total_amount,
        order.currency
      ]
    );

    await conn.commit();
    committed = true;

    return res.status(201).json({
      success: true,
      message: "Đã tạo lần thanh toán mới.",
      data: {
        paymentId: result.insertId,
        orderId,
        paymentMethod: "bank_transfer",
        amount: order.total_amount,
        currency: order.currency,
        paymentStatus: "pending",
        paymentDeadlineAt: order.payment_deadline_at
      }
    });

  } catch (err) {
    if (conn && !committed) {
      try {
        await conn.rollback();
      } catch (_) {}
    }

    console.error("MARKETPLACE PAYMENT ATTEMPT ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Không thể tạo lần thanh toán mới."
    });

  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
