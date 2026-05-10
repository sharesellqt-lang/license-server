const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const db = require("../db");

const PLANS = require("../routes/plans");

// =====================================================
// CREATE PAYMENT
// =====================================================
router.post("/create-payment", auth, async (req, res) => {

  try {

    // =========================
    // PLAN INPUT
    // =========================
    const rawPlan = req.body.plan;

    const planKey = String(rawPlan || "")
      .trim()
      .toLowerCase();

    const planData = PLANS[planKey];

    if (!planData) {
      return res.status(400).json({
        error: "Invalid plan"
      });
    }

    const amount = planData.price;

    // =========================
    // CHECK EXISTING PENDING
    // =========================
    const [existing] = await db.query(`
      SELECT * FROM payments
      WHERE user_id = ?
      AND plan = ?
      AND status = 'pending'
      LIMIT 1
    `, [req.user.id, planKey]);

    if (existing.length) {

      const old = existing[0];

      return res.json({
        paymentId: old.id,
        qrUrl: `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png?amount=${old.amount}&addInfo=${old.content}`,
        content: old.content,
        amount: old.amount
      });
    }

    // =========================
    // NEW PAYMENT CONTENT
    // =========================
    const content =
      `${planKey.toUpperCase()}-ORDER-${req.user.id}-${Date.now()}`;

    // =========================
    // INSERT PAYMENT
    // =========================
    const [result] = await db.query(`
      INSERT INTO payments
      (user_id, plan, amount, method, status, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      req.user.id,
      planKey,
      amount,
      "bank",
      "pending",
      content
    ]);

    // =========================
    // QR URL
    // =========================
    const qrUrl =
      `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png?amount=${amount}&addInfo=${content}`;

    return res.json({
      paymentId: result.insertId,
      qrUrl,
      content,
      amount
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message
    });
  }
});


// =====================================================
// PAYMENT STATUS
// =====================================================
router.get("/payment-status/:id", auth, async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT status
      FROM payments
      WHERE id = ?
      AND user_id = ?
    `, [req.params.id, req.user.id]);

    if (!rows.length) {
      return res.status(404).json({
        error: "Payment not found"
      });
    }

    return res.json(rows[0]);

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message
    });
  }
});


// =====================================================
// PAYMENT WEBHOOK
// =====================================================
router.post("/payment-webhook", async (req, res) => {

  try {

    // =========================
    // VERIFY SECRET
    // =========================
    const secret = req.headers["x-webhook-secret"];

    if (!secret || secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { content, transactionId, amount } = req.body;

    if (!content || !transactionId) {
      return res.status(400).json({
        error: "Missing data"
      });
    }

    // =========================
    // FIND PAYMENT
    // =========================
    const [rows] = await db.query(`
      SELECT * FROM payments WHERE content = ?
    `, [content]);

    if (!rows.length) {
      return res.status(404).json({
        error: "Payment not found"
      });
    }

    const payment = rows[0];

    // =========================
    // AMOUNT CHECK
    // =========================
    if (Number(amount) < Number(payment.amount)) {
      return res.status(400).json({
        error: "Insufficient payment"
      });
    }

    // =========================
    // DUPLICATE TRANSACTION
    // =========================
    const [dup] = await db.query(`
      SELECT id FROM payments WHERE transaction_id = ?
    `, [transactionId]);

    if (dup.length) {
      return res.json({
        success: true,
        message: "Duplicate"
      });
    }

    // =========================
    // EXPIRE DATE
    // =========================
    const expireAt =
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // =========================
    // UPDATE USER
    // =========================
    await db.query(`
      UPDATE users
      SET plan = ?, expire_at = ?
      WHERE id = ?
    `, [
      payment.plan,
      expireAt,
      payment.user_id
    ]);

    // =========================
    // UPDATE PAYMENT
    // =========================
    await db.query(`
      UPDATE payments
      SET status = 'paid',
          transaction_id = ?,
          paid_at = NOW()
      WHERE id = ?
    `, [
      transactionId,
      payment.id
    ]);

    console.log("PAYMENT PAID:", payment.id);

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;