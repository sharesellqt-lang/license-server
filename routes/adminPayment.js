const express = require("express");
const router = express.Router();
const db = require("../db");

// =========================
// GET ALL PENDING PAYMENTS
// =========================
router.get("/payments", async (req, res) => {
  const [rows] = await db.query(
    `SELECT * FROM payments
     WHERE status IN ('pending','pending_review')
     ORDER BY id DESC`
  );

  res.json(rows);
});

// =========================
// APPROVE PAYMENT
// =========================
router.post("/approve", async (req, res) => {

  const { paymentId } = req.body;

  const [rows] = await db.query(
    "SELECT * FROM payments WHERE id=?",
    [paymentId]
  );

  const payment = rows[0];

  // ✔ 1. UPDATE PAYMENT (QUAN TRỌNG NHẤT)
  await db.query(
    `UPDATE payments
     SET status='paid',
         paid_at=NOW()
     WHERE id=?`,
    [paymentId]
  );

  // ✔ 2. UPDATE USER (PHỤ)
  await db.query(
    `UPDATE users
     SET plan=?
     WHERE id=?`,
    [payment.plan, payment.user_id]
  );

  res.json({ success: true });
});

// =========================
// REJECT PAYMENT
// =========================
router.post("/reject", async (req, res) => {
  const { paymentId } = req.body;

  await db.query(
    `UPDATE payments
     SET status='rejected'
     WHERE id=?`,
    [paymentId]
  );

  res.json({ success: true });
});

module.exports = router;