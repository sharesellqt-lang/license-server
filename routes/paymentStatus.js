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
    // Lấy lại từ DB mới nhất
    const [rows] = await db.query(
      "SELECT status, approved_by_admin FROM payments WHERE id = ?",
      [paymentId]
    );
    if (!rows.length) return;

    const payment = rows[0];
    const approvedByAdmin = payment.approved_by_admin === 1;

    console.log("SSE send:", payment.status, approvedByAdmin);

   res.write(`data: ${JSON.stringify({
  status: payment.status,
  approvedByAdmin,
  amount: payment.amount,
  plan: payment.plan,
  content: payment.content // hoặc note QR
})}\n\n`);

    // Đóng SSE chỉ khi approved hoặc rejected
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