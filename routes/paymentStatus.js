const express = require("express");
const router = express.Router();
const db = require("../db");

// =====================================================
// GET PAYMENT STATUS (FIXED)
// =====================================================
router.get("/payment-status/:id", async (req, res) => {

  try {

    const paymentId = req.params.id;

    const [rows] = await db.query(
      `SELECT id, user_id, status, plan, bill_image, updated_at
       FROM payments
       WHERE id = ?`,
      [paymentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Payment not found"
      });
    }

    const payment = rows[0];

    return res.json({
      id: payment.id,
      user_id: payment.user_id,
      status: payment.status,
      plan: payment.plan,
      bill_image: payment.bill_image || null,
      updated_at: payment.updated_at
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error"
    });
  }
});

module.exports = router;