const upload = require("../middleware/upload");
const express = require("express");
const router = express.Router();
const db = require("../db");

// =========================
// TELEGRAM CONFIG SAFE
// =========================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// =========================
// SAFE TELEGRAM
// =========================
async function notifyAdmin(paymentId, filePath) {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log("⚠ Telegram not configured");
      return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    const message = `
🧾 NEW PAYMENT BILL UPLOADED
Payment ID: ${paymentId}
File: ${filePath}
    `;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      })
    });

  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

// =========================
// UPLOAD BILL ROUTE
// =========================
router.post(
  "/upload-bill",
  upload.single("bill"),
  async (req, res) => {
    try {
      const paymentId = Number(req.body.paymentId);
      const file = req.file;

      console.log("BODY:", req.body);
      console.log("FILE:", file);

      if (!paymentId || isNaN(paymentId)) {
        return res.status(400).json({
          error: "Invalid paymentId"
        });
      }

      if (!file) {
        return res.status(400).json({
          error: "Missing bill file"
        });
      }

      // CHECK PAYMENT
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

      // Chỉ cho upload khi đang pending
      if (
        !["pending", "pending_review"].includes(
          String(payment.status).trim().toLowerCase()
        )
      ) {
        return res.status(400).json({
          error: "Payment is not pending"
        });
      }

      // UPDATE DB
      await db.query(
        `
        UPDATE payments
        SET
          bill_image = ?,
          status = 'pending_review'
        WHERE id = ?
        `,
        [file.filename, paymentId]
      );

      // Notify admin
      notifyAdmin(paymentId, file.filename);

      return res.json({
        success: true,
        paymentId,
        status: "pending_review"
      });

    } catch (err) {
      console.error("UPLOAD BILL ERROR:", err);

      return res.status(500).json({
        error: err.message
      });
    }
  }
);

module.exports = router;