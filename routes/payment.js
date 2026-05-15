const express = require("express");
if (!process.env.BANK_ID || !process.env.BANK_ACCOUNT) {
  throw new Error("Missing BANK_ID or BANK_ACCOUNT in .env");
}

const router = express.Router();

const auth = require("../middleware/auth");
const db = require("../db");
const { getPlan } = require("./plans");

// =====================================================
// HELPER
// =====================================================
function buildPaymentNote(userId, paymentId) {
  return `USER_${userId}_${paymentId}`;
}

// =====================================================
// NORMALIZE BANK (SAFE + FRONTEND FRIENDLY)
// =====================================================
function getBankInfo() {

  return {
    name: process.env.BANK_NAME?.trim() || "",
    account: process.env.BANK_ACCOUNT?.trim() || "",
    owner: process.env.BANK_OWNER?.trim() || ""
  };
}

// =====================================================
// CREATE PAYMENT
// =====================================================
router.post("/create-payment", auth, async (req, res) => {

  try {

    // =========================
    // 1. PLAN
    // =========================
    const planKey = String(req.body.plan || "")
      .trim()
      .toLowerCase();

    const planData = getPlan(planKey);

    if (!planData) {
      return res.status(400).json({ error: "Invalid plan" });
    }

const cycle = String(req.body.cycle || "month")
  .trim()
  .toLowerCase();

const multiplier =
  cycle === "year"
    ? 12
    : 1;

const yearlyDiscount =
  typeof planData.yearlyDiscount === "number"
    ? (1 - planData.yearlyDiscount)
    : 1;

const discount =
  cycle === "year"
    ? yearlyDiscount
    : 1;

const amount = Math.round(
  planData.price *
  multiplier *
  discount
);

console.log("PLAN DATA:", planData);
console.log("CYCLE:", cycle);
console.log("AMOUNT:", amount);
    // =========================
    // 2. EXISTING PAYMENT
    // =========================
    const [existing] = await db.query(`
      SELECT id, amount, content, plan
      FROM payments
      WHERE user_id = ?
        AND plan = ?
        AND status = 'pending'
        AND created_at >= NOW() - INTERVAL 15 MINUTE
      LIMIT 1
    `, [req.user.id, planKey]);

    if (existing.length) {

      const old = existing[0];

      const bank = getBankInfo();

      const qrNote = encodeURIComponent(old.content || "");

      const qrUrl =
        `https://img.vietqr.io/image/${bank.account ? process.env.BANK_ID : ""}-${bank.account}-print.png` +
        `?amount=${old.amount}&addInfo=${qrNote}`;

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
    // 4. NOTE
    // =========================
    const content = buildPaymentNote(req.user.id, paymentId);

    await db.query(`
      UPDATE payments SET content = ? WHERE id = ?
    `, [content, paymentId]);

    // =========================
    // 5. QR
    // =========================
    const bank = getBankInfo();

    const qrNote = encodeURIComponent(content);

    const qrUrl =
      `https://img.vietqr.io/image/${process.env.BANK_ID}-${bank.account}-print.png` +
      `?amount=${amount}&addInfo=${qrNote}`;

    // =========================
    // 6. RESPONSE (STRICT FORMAT)
    // =========================
console.log("BANK ENV:", {
  name: process.env.BANK_NAME,
  account: process.env.BANK_ACCOUNT,
  owner: process.env.BANK_OWNER
});
console.log("BANK DEBUG:", getBankInfo());
    return res.json({
      paymentId,
      amount,
      content,
      qrUrl,
      bank: getBankInfo()
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;