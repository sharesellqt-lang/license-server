console.log("WEBHOOK BODY:", req.body);
const express = require("express");

const router = express.Router();

const db = require("../db");

const { getExpireDate } = require("../services/planService");
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
  try {
    const { content, transactionId, amount } = req.body;

    if (!content || !transactionId) {
      return res.status(400).json({
        error: "Missing data"
      });
    }

    // =========================
    // FIND PAYMENT
    // =========================
    const normalizedIncoming = normalizeContent(content);

const [rows] = await db.query(`
  SELECT *
  FROM payments
  WHERE status = 'pending'
`);

const payment = rows.find(p =>
  normalizeContent(p.content) === normalizedIncoming
);

if (!payment) {

  console.log("❌ PAYMENT NOT FOUND");
  console.log("Incoming:", content);
  console.log("Normalized:", normalizedIncoming);

  return res.json({
    success: false,
    message: "Payment not found"
  });
}

    if (!rows.length) {
      return res.json({
        success: false,
        message: "Payment not found"
      });
    }

    const payment = rows[0];

    // =========================
    // DUPLICATE TRANSACTION
    // =========================
    const [dup] = await db.query(
      `
      SELECT id
      FROM payments
      WHERE transaction_id = ?
      `,
      [transactionId]
    );

    if (dup.length) {
      return res.json({
        success: true,
        message: "Duplicate transaction"
      });
    }

    // =========================
    // CHECK AMOUNT
    // =========================
    if (Number(amount) < Number(payment.amount)) {
      return res.status(400).json({
        error: "Insufficient payment"
      });
    }

    // =========================
    // EXPIRE DATE
    // =========================
    const expireAt = getExpireDate(30);

    // =========================
    // UPDATE USER
    // =========================
    await db.query(
      `
      UPDATE users
      SET plan = ?, expire_at = ?
      WHERE id = ?
      `,
      [payment.plan, expireAt, payment.user_id]
    );

    // =========================
    // UPDATE PAYMENT
    // =========================
    await db.query(
      `
      UPDATE payments
      SET status = 'paid',
          transaction_id = ?,
          paid_at = NOW()
      WHERE id = ?
      `,
      [transactionId, payment.id]
    );

    console.log("✅ Payment success:", payment.id);

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Webhook failed"
    });
  }
});

module.exports = router;