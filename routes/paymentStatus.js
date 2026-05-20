const express = require("express");
const router = express.Router();
const db = require("../db");

// =====================================================
// PAYMENT STREAM SSE - lắng nghe trạng thái payment
// =====================================================
router.get("/payment-stream/:id", async (req, res) => {
  const paymentId = req.params.id;

  // Cấu hình SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Hàm gửi trạng thái payment
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

      if (payment.status === "paid" && payment.approved_by_admin !== 1) {
      return; // chặn fake paid
      }
      console.log("SSE PAYMENT:", payment);

      // Chỉ gửi các status hợp lệ
      if (!["pending", "pending_review", "paid", "rejected"].includes(payment.status)) {
        return;
      }

     res.write(`data: ${JSON.stringify({
     status: payment.status
     })}\n\n`);

      // Nếu payment đã xong (paid hoặc rejected) -> đóng SSE
      if (payment.status === "paid" || payment.status === "rejected") {
        clearInterval(intervalId);
        res.end();
      }
    } catch (err) {
      console.error("SSE ERROR:", err);
    }
  };

  const intervalId = setInterval(sendStatus, 2000);

  // Gửi ngay lần đầu
  sendStatus();
});

module.exports = router;