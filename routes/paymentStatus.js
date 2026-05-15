const express = require("express");
const router = express.Router();
const db = require("../db");

// =====================================================
// PAYMENT STREAM (SSE) FIXED
// =====================================================
router.get("/payment-stream/:id", async (req, res) => {
  const paymentId = req.params.id;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.(); // Node < 18 không có flushHeaders, an toàn với optional chaining

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

      // Chỉ gửi trạng thái hợp lệ
      const validStatuses = ["pending", "pending_review", "paid", "rejected"];
      if (!validStatuses.includes(payment.status)) return;

      res.write(
        `data: ${JSON.stringify({
          status: payment.status,
          approvedByAdmin: payment.approved_by_admin === 1
        })}\n\n`
      );

      // Nếu đã paid hoặc rejected thì dừng SSE
      if (payment.status === "paid" || payment.status === "rejected") {
        clearInterval(intervalId);
        res.end();
      }
    } catch (err) {
      console.error("SSE ERROR:", err);
    }
  };

  // gửi ngay lần đầu
  sendStatus();

  // polling mỗi 2 giây
  const intervalId = setInterval(sendStatus, 2000);

  // cleanup khi client disconnect
  req.on("close", () => {
    clearInterval(intervalId);
  });
});

module.exports = router;