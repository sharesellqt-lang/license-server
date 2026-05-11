const express = require("express");
if (!process.env.BANK_ID || !process.env.BANK_ACCOUNT) {
  throw new Error("Missing BANK_ID or BANK_ACCOUNT in .env");
}

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

    // =========================
    // 1. VALIDATE PLAN
    // =========================
    const planKey = String(req.body.plan || "")
      .trim()
      .toLowerCase();

    const planData = getPlan(planKey);

    if (!planData) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const amount = planData.price;

    // =========================
    // 2. CHECK EXISTING PAYMENT
    // =========================
    const [existing] = await db.query(`
      SELECT id, amount, content, plan
      FROM payments
      WHERE user_id = ?
        AND plan = ?
        AND status = 'pending'
      LIMIT 1
    `, [req.user.id, planKey]);

    if (existing.length) {

  const old = existing[0];

  const bankId = process.env.BANK_ID?.trim();
  const bankAccount = process.env.BANK_ACCOUNT?.trim();

  const qrNote = encodeURIComponent(old.content || "");

  const qrUrl =
    `https://img.vietqr.io/image/${bankId}-${bankAccount}-print.png` +
    `?amount=${old.amount}&addInfo=${qrNote}`;

  const bank = {
    name: process.env.BANK_NAME || "",
    account: bankAccount || "",
    owner: process.env.BANK_OWNER || ""
  };

  return res.json({
    paymentId: old.id,
    amount: old.amount,
    content: old.content || "",
    qrUrl,
    bank
  });
}

    // =========================
    // 3. CREATE PAYMENT
    // =========================
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

    // =========================
    // 4. STABLE NOTE
    // =========================
    const content = buildPaymentNote(req.user.id, paymentId);

    await db.query(`
      UPDATE payments SET content = ? WHERE id = ?
    `, [content, paymentId]);

    // =========================
    // 5. QR
    // =========================
    const qrNote = encodeURIComponent(content);

    const qrUrl =
      `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png` +
      `?amount=${amount}&addInfo=${qrNote}`;

    // =========================
    // 6. RESPONSE
    // =========================
    return res.json({
      paymentId,
      amount,
      content,
      qrUrl,

  bank: {
  name: process.env.BANK_NAME || "",
  account: process.env.BANK_ACCOUNT || "",
  owner: process.env.BANK_OWNER || ""
}
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;