const express = require("express");
const router = express.Router();
const db = require("../db");

// =====================================================
// GET PAYMENT STATUS
// =====================================================
router.get("/payment-status/:id", async (req, res) => {

  try {

    const paymentId = req.params.id;

    const [rows] = await db.query(
      `SELECT id, status, bill_image
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
      status: payment.status,
      bill_image: payment.bill_image || null
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error"
    });
  }
});

module.exports = router;