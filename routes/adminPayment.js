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

  try {
    // 1. lấy payment
    const [rows] = await db.query(
      `SELECT * FROM payments WHERE id=?`,
      [paymentId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Not found" });
    }

    const payment = rows[0];

    // 2. update payment
    await db.query(
      `UPDATE payments
       SET status='paid',
           paid_at=NOW()
       WHERE id=?`,
      [paymentId]
    );

    // 3. upgrade user
    await db.query(
      `UPDATE users
       SET plan=?
       WHERE id=?`,
      [payment.plan, payment.user_id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
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