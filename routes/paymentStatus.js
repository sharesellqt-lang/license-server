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

// =====================================================
// PAYMENT STATUS STREAM (SSE) - gửi liên tục trạng thái
// =====================================================
router.get("/payment-stream/:id", async (req, res) => {
  const paymentId = req.params.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendStatus = async () => {
    try {
      const [rows] = await db.query(
        "SELECT status FROM payments WHERE id = ?",
        [paymentId]
      );

      if (!rows.length) {
        res.write(`data: ${JSON.stringify({ status: "not_found" })}\n\n`);
        return;
      }

      const status = rows[0].status;
      res.write(`data: ${JSON.stringify({ status })}\n\n`);

      if (status === "paid" || status === "rejected") {
        clearInterval(intervalId);
        res.end();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const intervalId = setInterval(sendStatus, 2000);
  sendStatus(); // gửi ngay lần đầu
});

module.exports = router;