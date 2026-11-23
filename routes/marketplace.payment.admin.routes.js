
"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const requireContributorPermission = require("../middleware/requireContributorPermission");
const { writeAudit } = require("../services/contributor.audit.service");
const { sendReceiptFile } = require("../services/marketplace.receipt.service");

router.use(auth);

// Finance can view payment records only with this permission.
router.use(requireContributorPermission("marketplace.payment.view"));

const ALLOWED_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "refunded"
];

// GET /api/marketplace/admin/payments
router.get("/payments", async (req, res) => {
  try {
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Trạng thái thanh toán không hợp lệ."
      });
    }

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("p.status = ?");
      params.push(status);
    } else {
      conditions.push("p.status IN ('pending', 'processing')");
    }

    if (search) {
      conditions.push(`(
        o.order_code LIKE ?
        OR CAST(o.id AS CHAR) LIKE ?
        OR CAST(p.id AS CHAR) LIKE ?
        OR u.email LIKE ?
        OR p.transaction_reference LIKE ?
        OR p.provider_transaction_id LIKE ?
      )`);

      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword);
    }

    const whereSQL = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM marketplace_order_payments p
       INNER JOIN marketplace_orders o ON o.id = p.order_id
       INNER JOIN users u ON u.id = o.buyer_user_id
       ${whereSQL}`,
      params
    );

    const [rows] = await db.execute(
      `SELECT
         p.id AS payment_id,
         p.order_id,
         o.order_code,
         o.buyer_user_id,
         u.email AS buyer_email,
         o.total_amount AS order_total,
         o.currency,
         p.payment_method,
         p.amount AS payment_amount,
         p.status AS payment_status,
         p.transaction_reference,
         p.provider_transaction_id,
         p.receipt_storage_key IS NOT NULL AS has_receipt,
         p.submitted_at,
         p.verified_at,
         p.verified_by_user_id,
         p.created_at,
         p.updated_at
       FROM marketplace_order_payments p
       INNER JOIN marketplace_orders o ON o.id = p.order_id
       INNER JOIN users u ON u.id = o.buyer_user_id
       ${whereSQL}
       ORDER BY
         CASE WHEN p.status = 'processing' THEN 0 ELSE 1 END,
         p.submitted_at ASC,
         p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(countRows[0].total || 0),
        totalPages: Math.ceil(Number(countRows[0].total || 0) / limit)
      }
    });

  } catch (err) {
    console.error("MARKETPLACE FINANCE PAYMENT LIST ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Không thể tải danh sách thanh toán."
    });
  }
});

// GET /api/marketplace/admin/payments/:id
router.get("/payments/:id", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment ID không hợp lệ."
      });
    }

    const [payments] = await db.execute(
      `SELECT
         p.id AS payment_id,
         p.order_id,
         o.order_code,
         o.buyer_user_id,
         u.email AS buyer_email,
         o.subtotal,
         o.discount_amount,
         o.total_amount AS order_total,
         o.currency,
         o.payment_status AS order_payment_status,
         o.order_status,
         o.payment_deadline_at,
         p.payment_method,
         p.amount AS payment_amount,
         p.currency AS payment_currency,
         p.status AS payment_status,
         p.provider,
         p.provider_transaction_id,
         p.transaction_reference,
         p.receipt_storage_key IS NOT NULL AS has_receipt,
         p.submitted_at,
         p.verified_by_user_id,
         p.verified_at,
         p.verification_note,
         p.paid_at,
         p.created_at,
         p.updated_at
       FROM marketplace_order_payments p
       INNER JOIN marketplace_orders o ON o.id = p.order_id
       INNER JOIN users u ON u.id = o.buyer_user_id
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );

    if (!payments.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khoản thanh toán."
      });
    }

    const [items] = await db.execute(
      `SELECT
         id,
         product_id,
         seller_id,
         seller_user_id,
         product_title,
         product_version,
         product_type,
         unit_price,
         quantity,
         line_total,
         currency
       FROM marketplace_order_items
       WHERE order_id = ?
       ORDER BY id ASC`,
      [payments[0].order_id]
    );

    return res.json({
      success: true,
      data: {
        payment: payments[0],
        orderItems: items
      }
    });

  } catch (err) {
    console.error("MARKETPLACE FINANCE PAYMENT DETAIL ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Không thể tải chi tiết thanh toán."
    });
  }
});

// Convert DECIMAL(15,2) values to integer cents without floating-point errors.
function toCents(value) {
  const input = String(value ?? "").trim();

  if (!/^\d{1,13}(\.\d{1,2})?$/.test(input)) {
    return null;
  }

  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

// POST /api/marketplace/admin/payments/:id/verify
router.post(
  "/payments/:id/verify",
  requireContributorPermission("marketplace.payment.verify"),
  async (req, res) => {
    let conn;
    let committed = false;

    try {
      const paymentId = Number(req.params.id);
      const actorUserId = Number(req.user.id);

      if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Payment ID không hợp lệ."
        });
      }

      const decision = String(req.body.decision || "").trim();
      const note = String(req.body.note || "").trim();

      if (!["paid", "failed"].includes(decision)) {
        return res.status(400).json({
          success: false,
          message: "Quyết định phải là paid hoặc failed."
        });
      }

      if (decision === "failed" && !note) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập lý do từ chối thanh toán."
        });
      }

      if (note.length > 5000) {
        return res.status(400).json({
          success: false,
          message: "Ghi chú không được vượt quá 5000 ký tự."
        });
      }

      const transactionId = String(
        req.body.providerTransactionId || ""
      ).trim();

      if (decision === "paid") {
        if (!transactionId || transactionId.length > 255) {
          return res.status(400).json({
            success: false,
            message: "Cần nhập mã giao dịch thực tế từ ngân hàng."
          });
        }

        if (req.body.receivedAmount === undefined) {
          return res.status(400).json({
            success: false,
            message: "Cần nhập số tiền thực tế ngân hàng đã nhận."
          });
        }
      }

      conn = await db.getConnection();
      await conn.beginTransaction();

      // Lock order first, then payment, consistently with other payment operations.
      const [paymentRefs] = await conn.execute(
        `SELECT order_id
         FROM marketplace_order_payments
         WHERE id = ?
         LIMIT 1`,
        [paymentId]
      );

      if (!paymentRefs.length) {
        await conn.rollback();

        return res.status(404).json({
          success: false,
          message: "Không tìm thấy khoản thanh toán."
        });
      }

      const orderId = paymentRefs[0].order_id;

      const [orders] = await conn.execute(
        `SELECT id, order_code, total_amount, currency,
                payment_status, order_status
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

      const [payments] = await conn.execute(
        `SELECT *
         FROM marketplace_order_payments
         WHERE id = ?
           AND order_id = ?
         LIMIT 1
         FOR UPDATE`,
        [paymentId, orderId]
      );

      if (!payments.length) {
        await conn.rollback();

        return res.status(404).json({
          success: false,
          message: "Không tìm thấy khoản thanh toán."
        });
      }

      const order = orders[0];
      const payment = payments[0];

      if (!["pending", "processing"].includes(payment.status)) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          message: `Khoản thanh toán đã ở trạng thái ${payment.status}, không thể xác minh lại.`
        });
      }

      if (decision === "paid") {
        if (payment.payment_method !== "bank_transfer") {
          await conn.rollback();

          return res.status(400).json({
            success: false,
            message: "API này chỉ xác minh chuyển khoản ngân hàng."
          });
        }

        if (!payment.submitted_at || !payment.receipt_storage_key) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            message: "Người mua chưa gửi biên lai thanh toán."
          });
        }

        const orderAmount = toCents(order.total_amount);
        const paymentAmount = toCents(payment.amount);
        const receivedAmount = toCents(req.body.receivedAmount);

        if (
          orderAmount === null ||
          paymentAmount === null ||
          receivedAmount === null
        ) {
          await conn.rollback();

          return res.status(400).json({
            success: false,
            message: "Số tiền không hợp lệ."
          });
        }

        if (
          paymentAmount !== orderAmount ||
          receivedAmount !== orderAmount
        ) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            code: "PAYMENT_AMOUNT_MISMATCH",
            message: "Số tiền thực nhận không khớp chính xác tổng tiền đơn hàng. Không thể tự động xác nhận.",
            data: {
              orderAmount: String(order.total_amount),
              paymentAmount: String(payment.amount),
              receivedAmount: String(req.body.receivedAmount)
            }
          });
        }

        if (payment.currency !== order.currency) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            code: "PAYMENT_CURRENCY_MISMATCH",
            message: "Đơn vị tiền tệ của payment không khớp đơn hàng."
          });
        }

        // Explicit duplicate check for a useful error.
        const [duplicates] = await conn.execute(
          `SELECT id
           FROM marketplace_order_payments
           WHERE provider_transaction_id = ?
             AND id <> ?
           LIMIT 1`,
          [transactionId, paymentId]
        );

        if (duplicates.length) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            code: "DUPLICATE_BANK_TRANSACTION",
            message: "Mã giao dịch ngân hàng đã được sử dụng cho khoản thanh toán khác."
          });
        }

        if (order.payment_status === "paid") {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            message: "Đơn hàng đã được thanh toán."
          });
        }

        await conn.execute(
          `UPDATE marketplace_order_payments
           SET status = 'paid',
               provider = 'manual_bank_transfer',
               provider_transaction_id = ?,
               verified_by_user_id = ?,
               verified_at = NOW(),
               verification_note = ?,
               paid_at = NOW()
           WHERE id = ?`,
          [
            transactionId,
            actorUserId,
            note || null,
            paymentId
          ]
        );

        await conn.execute(
          `UPDATE marketplace_orders
           SET payment_status = 'paid',
               order_status = 'paid',
               paid_at = NOW()
           WHERE id = ?`,
          [orderId]
        );

      } else {
        await conn.execute(
          `UPDATE marketplace_order_payments
           SET status = 'failed',
               verified_by_user_id = ?,
               verified_at = NOW(),
               verification_note = ?
           WHERE id = ?`,
          [actorUserId, note, paymentId]
        );

        // The order remains unpaid. A new payment attempt must be created
        // before the buyer can submit another transfer.
        await conn.execute(
          `UPDATE marketplace_orders
           SET payment_status = 'pending',
               order_status = 'pending_payment'
           WHERE id = ?
             AND payment_status <> 'paid'`,
          [orderId]
        );
      }

      await writeAudit(conn, {
        actorUserId,
        action: decision === "paid"
          ? "marketplace_payment_verified"
          : "marketplace_payment_rejected",
        entityType: "marketplace_order_payment",
        entityId: String(paymentId),
        oldData: {
          paymentStatus: payment.status,
          orderPaymentStatus: order.payment_status,
          orderStatus: order.order_status
        },
        newData: {
          paymentStatus: decision,
          orderPaymentStatus: decision === "paid" ? "paid" : "pending",
          orderStatus: decision === "paid" ? "paid" : "pending_payment",
          providerTransactionId: decision === "paid" ? transactionId : null,
          verificationNote: note || null
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null
      });

      await conn.commit();
      committed = true;

      return res.json({
        success: true,
        message: decision === "paid"
          ? "Đã xác minh thanh toán thành công."
          : "Đã từ chối khoản thanh toán.",
        data: {
          paymentId,
          orderId,
          paymentStatus: decision,
          orderPaymentStatus: decision === "paid" ? "paid" : "pending"
        }
      });

    } catch (err) {
      if (conn && !committed) {
        try {
          await conn.rollback();
        } catch (_) {}
      }

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_BANK_TRANSACTION",
          message: "Mã giao dịch ngân hàng đã được sử dụng."
        });
      }

      console.error("MARKETPLACE PAYMENT VERIFICATION ERROR:", err);

      return res.status(500).json({
        success: false,
        message: "Không thể xử lý xác minh thanh toán."
      });

    } finally {
      if (conn) conn.release();
    }
  }
);

// Finance can view a receipt only with marketplace.payment.view.
router.get("/payments/:id/receipt", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment ID không hợp lệ."
      });
    }

    const [rows] = await db.execute(
      `SELECT receipt_storage_key
       FROM marketplace_order_payments
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khoản thanh toán."
      });
    }

    return sendReceiptFile(res, rows[0].receipt_storage_key);

  } catch (err) {
    console.error("FINANCE RECEIPT ACCESS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Không thể xem biên lai."
    });
  }
});

module.exports = router;
