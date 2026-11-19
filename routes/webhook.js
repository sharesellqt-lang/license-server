
"use strict";

const express = require("express");
const router = express.Router();

const db = require("../db");
const planService = require("../services/planService");

// =====================================================
// HELPERS
// =====================================================
function normalizeContent(str) {
  return String(str || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function parsePaymentReference(content) {
  const value = String(content || "").trim();

  // Định dạng nội dung do payment.js tạo:
  // USER_userId_paymentId
  const match = value.match(/^USER[_\s-]*(\d+)[_\s-]+(\d+)$/i);

  if (!match) {
    throw new Error("INVALID_PAYMENT_REFERENCE");
  }

  return {
    userId: Number(match[1]),
    paymentId: Number(match[2])
  };
}

function parseSnapshot(value) {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    throw new Error("INVALID_PAYMENT_SNAPSHOT");
  }
}

function isValidTimestamp(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

// =====================================================
// PAYMENT WEBHOOK
// =====================================================
router.post("/payment-webhook", async (req, res) => {
  let connection;

  try {
    const { content, transactionId, amount } = req.body || {};

    if (!content || !transactionId || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing data"
      });
    }

    const incomingContent = normalizeContent(content);
    const incomingTransactionId = String(transactionId).trim();
    const incomingAmount = Number(amount);

    if (
      !incomingContent ||
      !incomingTransactionId ||
      !Number.isFinite(incomingAmount) ||
      incomingAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment data"
      });
    }

    const reference = parsePaymentReference(content);

    if (
      !Number.isSafeInteger(reference.userId) ||
      reference.userId <= 0 ||
      !Number.isSafeInteger(reference.paymentId) ||
      reference.paymentId <= 0
    ) {
      throw new Error("INVALID_PAYMENT_REFERENCE");
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // =================================================
    // 1. FIND AND LOCK EXACT PAYMENT
    // =================================================
    const [paymentRows] = await connection.execute(
      `SELECT *
       FROM payments
       WHERE id = ?
         AND user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [reference.paymentId, reference.userId]
    );

    if (!paymentRows.length) {
      throw new Error("PAYMENT_NOT_FOUND");
    }

    const payment = paymentRows[0];

    // Đối chiếu nội dung chuyển khoản với đơn trong database.
    if (normalizeContent(payment.content) !== incomingContent) {
      throw new Error("PAYMENT_CONTENT_MISMATCH");
    }

    // =================================================
    // 2. CHECK DUPLICATE TRANSACTION
    // =================================================
    const [duplicates] = await connection.execute(
      `SELECT id, user_id
       FROM payments
       WHERE transaction_id = ?
       LIMIT 1
       FOR UPDATE`,
      [incomingTransactionId]
    );

    if (duplicates.length) {
      const duplicate = duplicates[0];

      // Webhook gửi lại cùng giao dịch đã xử lý.
      if (Number(duplicate.id) === Number(payment.id)) {
        await connection.commit();

        return res.json({
          success: true,
          message: "Duplicate transaction",
          paymentId: payment.id
        });
      }

      throw new Error("TRANSACTION_ALREADY_USED");
    }

    // =================================================
    // 3. CHECK PAYMENT STATUS
    // =================================================
    if (!["pending", "pending_review"].includes(payment.status)) {
      throw new Error("PAYMENT_NOT_PENDING");
    }

    if (incomingAmount < Number(payment.amount)) {
      throw new Error("INSUFFICIENT_PAYMENT");
    }

    const plan = String(payment.plan || "").trim().toLowerCase();
    const cycle = String(payment.cycle || "month").trim().toLowerCase();

    if (!["pro", "vip"].includes(plan)) {
      throw new Error("INVALID_PAYMENT_PLAN");
    }

    if (!["month", "year"].includes(cycle)) {
      throw new Error("INVALID_PAYMENT_CYCLE");
    }

    // =================================================
    // 4. VALIDATE PAYMENT SNAPSHOT
    // =================================================
    const paymentSnapshot = parseSnapshot(payment.plan_snapshot);
    const paymentType = paymentSnapshot.type || "purchase";

    if (
      paymentSnapshot.cycle &&
      paymentSnapshot.cycle !== cycle
    ) {
      throw new Error("PAYMENT_CYCLE_MISMATCH");
    }

    if (
      paymentSnapshot.amount !== undefined &&
      Number(paymentSnapshot.amount) !== Number(payment.amount)
    ) {
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }

    // =================================================
    // 5. APPLY PLAN
    // =================================================
    let planResult;

    if (paymentType === "upgrade") {
      if (
        paymentSnapshot.fromPlan !== "pro" ||
        paymentSnapshot.toPlan !== "vip" ||
        plan !== "vip"
      ) {
        throw new Error("INVALID_UPGRADE_PAYMENT");
      }

      if (
        !isValidTimestamp(paymentSnapshot.originalExpireMs) ||
        !isValidTimestamp(paymentSnapshot.remainingRatio) ||
        Number(paymentSnapshot.remainingRatio) > 1
      ) {
        throw new Error("INVALID_UPGRADE_SNAPSHOT");
      }

      planResult = await planService.upgradePlan(connection, {
        userId: payment.user_id,
        cycle,
        expectedExpireMs: Number(paymentSnapshot.originalExpireMs)
      });

    } else if (
      paymentType === "purchase" ||
      paymentType === "renewal"
    ) {
      planResult = await planService.applyPlan(connection, {
        userId: payment.user_id,
        plan,
        durationMonths: cycle === "year" ? 12 : 1,
        durationDays: 0,
        cycle,
        allowDowngrade: false
      });

    } else {
      throw new Error("INVALID_PAYMENT_TYPE");
    }

    // =================================================
    // 6. SAVE PAYMENT SNAPSHOT
    // =================================================
    const planSnapshot = JSON.stringify({
      ...paymentSnapshot,
      type: paymentType,
      plan,
      cycle,
      paymentId: payment.id,
      transactionId: incomingTransactionId,
      requestedAmount: Number(payment.amount),
      receivedAmount: incomingAmount,
      planBefore: planResult.planBefore,
      planAfter: planResult.planAfter,
      previousExpireAt: planResult.previousExpireAt || null,
      planStartDate: planResult.planStartDate || null,
      expireAt: planResult.expireAt,
      processedBy: "webhook"
    });

    // =================================================
    // 7. UPDATE PAYMENT
    // =================================================
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
         AND user_id = ?
         AND status IN ('pending', 'pending_review')`,
      [
        incomingTransactionId,
        planResult.planStartDate || null,
        planResult.expireAt,
        planSnapshot,
        payment.id,
        payment.user_id
      ]
    );

    if (!updateResult.affectedRows) {
      throw new Error("PAYMENT_UPDATE_FAILED");
    }

    // =================================================
    // 8. COMMIT
    // =================================================
    await connection.commit();

    console.log("PAYMENT SUCCESS:", {
      paymentId: payment.id,
      userId: payment.user_id,
      paymentType,
      plan,
      cycle,
      amount: incomingAmount
    });

    return res.json({
      success: true,
      message: "Payment processed",
      paymentId: payment.id,
      paymentType,
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

    const clientErrors = [
      "INVALID_PAYMENT_REFERENCE",
      "PAYMENT_NOT_FOUND",
      "PAYMENT_CONTENT_MISMATCH",
      "TRANSACTION_ALREADY_USED",
      "PAYMENT_NOT_PENDING",
      "INSUFFICIENT_PAYMENT",
      "INVALID_PAYMENT_PLAN",
      "INVALID_PAYMENT_CYCLE",
      "PAYMENT_CYCLE_MISMATCH",
      "PAYMENT_AMOUNT_MISMATCH",
      "INVALID_PAYMENT_SNAPSHOT",
      "INVALID_PAYMENT_TYPE",
      "INVALID_UPGRADE_PAYMENT",
      "INVALID_UPGRADE_SNAPSHOT",
      "PLAN_DOWNGRADE_NOT_ALLOWED",
      "UPGRADE_SOURCE_PLAN_INVALID",
      "PLAN_EXPIRED",
      "UPGRADE_CYCLE_MISMATCH",
      "UPGRADE_QUOTE_EXPIRED",
      "PRO_SUBSCRIPTION_EXPIRED",
      "USER_NOT_FOUND"
    ];

    const status =
      err.message === "PAYMENT_NOT_FOUND" ? 404 :
      err.message === "TRANSACTION_ALREADY_USED" ? 409 :
      clientErrors.includes(err.message) ? 400 : 500;

    console.error("PAYMENT WEBHOOK ERROR:", {
      code: err.message,
      message: err.message
    });

    return res.status(status).json({
      success: false,
      error: "Webhook failed",
      code: err.message || "UNKNOWN_ERROR"
    });

  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
