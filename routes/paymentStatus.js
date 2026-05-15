const express = require("express");
const router = express.Router();
const db = require("../db");

// =====================================================
// GET PAYMENT STATUS (FIXED)
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

      // ✅ Chỉ "pending" hoặc admin đã "paid"/"rejected"
      if (["pending", "pending_review", "paid", "rejected"].includes(status)) {
        res.write(`data: ${JSON.stringify({ status })}\n\n`);
      }

      if (status === "paid" || status === "rejected") {
        clearInterval(intervalId);
        res.end();
      }

    } catch (err) {
      console.error(err);
    }
  };

  const intervalId = setInterval(sendStatus, 2000);
  sendStatus(); // gửi lần đầu ngay
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