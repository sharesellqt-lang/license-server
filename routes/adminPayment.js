const express = require("express");
const router = express.Router();
const db = require("../db");

router.post("/approve-payment", async (req, res) => {

  const { paymentId } = req.body;

  const [rows] = await db.query(
    "SELECT * FROM payments WHERE id = ?",
    [paymentId]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Not found" });
  }

  const payment = rows[0];

  await db.query(
    "UPDATE payments SET status='paid', paid_at=NOW() WHERE id=?",
    [paymentId]
  );

  await db.query(
    "UPDATE users SET plan=? WHERE id=?",
    [payment.plan, payment.user_id]
  );

  res.json({ success: true });
});

module.exports = router;