const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/payment-stream/:id", async (req, res) => {
  const paymentId = req.params.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendStatus = async () => {
    try {
      const [rows] = await db.query(
        "SELECT status, approved_by_admin FROM payments WHERE id = ?",
        [paymentId]
      );

      if (!rows.length) {
        res.write(`data: ${JSON.stringify({ status: "not_found" })}\n\n`);
        clearInterval(intervalId);
        res.end();
        return;
      }

      const payment = rows[0];

      // Chỉ gửi các status hợp lệ
      if (!["pending", "pending_review", "paid", "rejected"].includes(payment.status)) {
        return;
      }

      const approvedByAdmin = payment.approved_by_admin === 1;

      // Gửi SSE
      res.write(`data: ${JSON.stringify({
        status: payment.status,
        approvedByAdmin
      })}\n\n`);

      // Chỉ đóng SSE khi thực sự xong
      if ((payment.status === "paid" && approvedByAdmin) || payment.status === "rejected") {
        clearInterval(intervalId);
        res.end();
      }

    } catch (err) {
      console.error("SSE ERROR:", err);
    }
  };

  const intervalId = setInterval(sendStatus, 2000);
  sendStatus(); // gửi ngay lần đầu
});

module.exports = router;