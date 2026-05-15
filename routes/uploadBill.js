const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload");
const db = require("../db");

// =========================
// TELEGRAM CONFIG
// =========================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// =========================
// TELEGRAM SAFE NOTIFY
// =========================
async function notifyAdmin(paymentId, fileName) {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log("⚠ Telegram not configured");
      return;
    }

    const message =
`🧾 NEW PAYMENT BILL UPLOADED
Payment ID: ${paymentId}
File: ${fileName}`;

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message
        })
      }
    );

  } catch (err) {
    console.error("Telegram notify error:", err.message);
  }
}

// =========================
// UPLOAD BILL ROUTE
// FINAL ENDPOINT:
// /api/upload-bill
// =========================
router.post(
  "/upload-bill",
  upload.single("bill"),
  async (req, res) => {
    try {
      console.log("BODY:", req.body);
      console.log("FILE:", req.file);

      const paymentId = Number(req.body.paymentId);
      const file = req.file;

      // =========================
      // VALIDATION
      // =========================
      if (!paymentId || Number.isNaN(paymentId)) {
        return res.status(400).json({
          error: "Invalid paymentId"
        });
      }

      if (!file) {
        return res.status(400).json({
          error: "Missing bill file"
        });
      }

      // =========================
      // CHECK PAYMENT
      // =========================
      const [payments] = await db.query(
        `
        SELECT id, status
        FROM payments
        WHERE id = ?
        LIMIT 1
        `,
        [paymentId]
      );

      if (!payments.length) {
        return res.status(404).json({
          error: "Payment not found"
        });
      }

      const payment = payments[0];
      const status = String(payment.status || "")
        .trim()
        .toLowerCase();

      // Chỉ cho upload khi payment đang chờ
      if (!["pending", "pending_review"].includes(status)) {
        return res.status(400).json({
          error: "Payment is not pending"
        });
      }

      // =========================
      // UPDATE PAYMENT
      // =========================
      const [result] = await db.query(
        `
        UPDATE payments
        SET
          bill_image = ?,
          status = 'pending_review'
        WHERE id = ?
        `,
        [file.filename, paymentId]
      );

      if (!result.affectedRows) {
        return res.status(500).json({
          error: "Update failed"
        });
      }

      // =========================
      // NOTIFY ADMIN
      // =========================
      notifyAdmin(paymentId, file.filename);

      // =========================
      // SUCCESS
      // =========================
      return res.json({
        success: true,
        paymentId,
        status: "pending_review",
        file: file.filename
      });

    } catch (err) {
      console.error("UPLOAD BILL ERROR:", err);

      return res.status(500).json({
        error: err.message
      });
    }
  }
);

// =========================
// EXPORT ROUTER (CRITICAL)
// =========================
module.exports = router;