const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const db = require("../db");

const { getPlan } = require("./plans");
// =====================================================
// 🔥 HELPER - NORMALIZE NOTE (SAFE FORMAT)
// =====================================================
function buildPaymentNote(userId, paymentId) {
  // 👉 FIXED FORMAT (KHÔNG BAO GIỜ ĐỔI)
  return `USER_${userId}_${paymentId}`;
}

// =====================================================
// CREATE PAYMENT
// =====================================================
router.post("/create-payment", auth, async (req, res) => {

  try {

    // =====================================================
    // 1. VALIDATE PLAN
    // =====================================================
    const planKey = String(req.body.plan || "")
      .trim()
      .toLowerCase();

    const planData = getPlan(planKey);

    if (!planData) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const amount = planData.price;

   if (existing.length) {

  const old = existing[0];

  const qrNote = encodeURIComponent(old.content);

  const qrUrl =
    `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png` +
    `?amount=${old.amount}&addInfo=${qrNote}`;

  return res.json({
    paymentId: old.id,
    amount: old.amount,
    content: old.content,
    qrUrl,

    bank: {
      name: process.env.BANK_NAME,
      account: process.env.BANK_ACCOUNT,
      owner: process.env.BANK_OWNER
    }
  });
}

    // =====================================================
    // 3. CREATE PAYMENT ROW FIRST
    // =====================================================
    const [result] = await db.query(`
      INSERT INTO payments
      (user_id, plan, amount, method, status)
      VALUES (?, ?, ?, ?, ?)
    `, [
      req.user.id,
      planKey,
      amount,
      "bank",
      "pending"
    ]);

    const paymentId = result.insertId;

    // =====================================================
    // 4. STABLE NOTE (SOURCE OF TRUTH)
    // =====================================================
    const content = buildPaymentNote(req.user.id, paymentId);

    await db.query(`
      UPDATE payments SET content = ? WHERE id = ?
    `, [content, paymentId]);

    // =====================================================
    // 5. QR GENERATION (ALWAYS ENCODED)
    // =====================================================
    const qrNote = encodeURIComponent(content);

    const qrUrl =
      `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png` +
      `?amount=${amount}&addInfo=${qrNote}`;

    // =====================================================
    // 6. RESPONSE (FRONTEND ONLY USE THIS)
    // =====================================================
    return res.json({
      paymentId,
      amount,
      content,
      qrUrl
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
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
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.json(rows[0]);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// =====================================================
// WEBHOOK (BANK CONFIRM)
// =====================================================
router.post("/payment-webhook", async (req, res) => {

  try {

    // =====================================================
    // 1. SECURITY CHECK
    // =====================================================
    const secret = req.headers["x-webhook-secret"];

    if (!secret || secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { content, transactionId, amount } = req.body;

    if (!content || !transactionId) {
      return res.status(400).json({ error: "Missing data" });
    }

    // =====================================================
    // 2. FIND PAYMENT BY CONTENT (STABLE KEY)
    // =====================================================
    const [rows] = await db.query(`
      SELECT * FROM payments WHERE content = ?
    `, [content]);

    if (!rows.length) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const payment = rows[0];

    // =====================================================
    // 3. AMOUNT CHECK
    // =====================================================
    if (Number(amount) < Number(payment.amount)) {
      return res.status(400).json({ error: "Insufficient amount" });
    }

    // =====================================================
    // 4. DUPLICATE TRANSACTION PROTECTION
    // =====================================================
    const [dup] = await db.query(`
      SELECT id FROM payments WHERE transaction_id = ?
    `, [transactionId]);

    if (dup.length) {
      return res.json({ success: true, message: "Duplicate ignored" });
    }

    // =====================================================
    // 5. EXPIRE DATE
    // =====================================================
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // =====================================================
    // 6. UPDATE USER PLAN
    // =====================================================
    await db.query(`
      UPDATE users
      SET plan = ?, expire_at = ?
      WHERE id = ?
    `, [
      payment.plan,
      expireAt,
      payment.user_id
    ]);

    // =====================================================
    // 7. UPDATE PAYMENT
    // =====================================================
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

    console.log("PAYMENT SUCCESS:", payment.id);

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;