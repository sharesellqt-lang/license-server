
"use strict";

const express = require("express");
const router = express.Router();

const db = require("../db");
const planService = require("../services/planService");

function normalizeContent(str) {
  return String(str || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

// =====================================================
// PAYMENT WEBHOOK
// =====================================================
router.post("/payment-webhook", async (req, res) => {
  let connection;

  try {
    console.log("WEBHOOK BODY:", JSON.stringify(req.body, null, 2));

    const { content, transactionId, amount } = req.body || {};

    if (!content || !transactionId || amount === undefined) {
      return res.status(400).json({ success: false, error: "Missing data" });
    }

    const incomingContent = normalizeContent(content);
    const incomingTransactionId = String(transactionId).trim();
    const incomingAmount = Number(amount);

    if (!incomingContent || !incomingTransactionId ||
        !Number.isFinite(incomingAmount) || incomingAmount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid payment data" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Kiểm tra giao dịch đã được xử lý trước đó.
    const [duplicates] = await connection.execute(
      `SELECT id, status
       FROM payments
       WHERE transaction_id = ?
       LIMIT 1
       FOR UPDATE`,
      [incomingTransactionId]
    );

    if (duplicates.length) {
      await connection.commit();
      return res.json({
        success: true,
        message: "Duplicate transaction"
      });
    }

    // Khóa các thanh toán đang chờ để tránh hai webhook xử lý cùng một khoản.
    const [pendingPayments] = await connection.query(
      `SELECT *
       FROM payments
       WHERE status IN ('pending', 'pending_review')
       ORDER BY id DESC
       FOR UPDATE`
    );

    const payment = pendingPayments.find(
      item => normalizeContent(item.content) === incomingContent
    );

    if (!payment) {
      await connection.rollback();
      return res.json({
        success: false,
        message: "Payment not found"
      });
    }

    if (incomingAmount < Number(payment.amount)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Insufficient payment"
      });
    }

    const plan = String(payment.plan || "").trim().toLowerCase();
    const cycle = String(payment.cycle || "month").trim().toLowerCase();

    if (!["pro", "vip"].includes(plan)) {
      throw new Error("INVALID_PAYMENT_PLAN");
    }

    if (!["month", "year"].includes(cycle)) {
      throw new Error("INVALID_PAYMENT_CYCLE");
    }

    // Thanh toán tháng = 1 tháng; thanh toán năm = 12 tháng.
    const planResult = await planService.applyPlan(connection, {
      userId: payment.user_id,
      plan,
      durationMonths: cycle === "year" ? 12 : 1,
      durationDays: 0,
      cycle,
      allowDowngrade: false
    });

    const planSnapshot = JSON.stringify({
      plan,
      cycle,
      paymentId: payment.id,
      transactionId: incomingTransactionId,
      amount: incomingAmount,
      planBefore: planResult.planBefore,
      planAfter: planResult.planAfter,
      previousExpireAt: planResult.previousExpireAt,
      planStartDate: planResult.planStartDate,
      expireAt: planResult.expireAt
    });

    const [updateResult] = await connection.execute(
      `UPDATE payments
       SET status = 'paid',
           approved_by_admin = 1,
           transaction_id = ?,
           paid_at = NOW(),
           plan_start_date = ?,
           expire_at = ?,
           plan_snapshot = ?
       WHERE id = ?
         AND status IN ('pending', 'pending_review')`,
      [
        incomingTransactionId,
        planResult.planStartDate,
        planResult.expireAt,
        planSnapshot,
        payment.id
      ]
    );

    if (!updateResult.affectedRows) {
      throw new Error("PAYMENT_UPDATE_FAILED");
    }

    await connection.commit();

    console.log("PAYMENT SUCCESS:", {
      paymentId: payment.id,
      userId: payment.user_id,
      plan,
      cycle,
      expireAt: planResult.expireAt
    });

    return res.json({
      success: true,
      message: "Payment processed",
      paymentId: payment.id,
      plan: planResult.planAfter,
      expireAt: planResult.expireAt
    });

  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("PAYMENT ROLLBACK ERROR:", rollbackError.message);
      }
    }

    console.error("PAYMENT WEBHOOK ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Webhook failed",
      code: err.message || "UNKNOWN_ERROR"
    });

  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
