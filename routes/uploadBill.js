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
// SAFE TELEGRAM (KHÔNG LÀM CRASH SERVER)
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
      headers: { "Content-Type": "application/json" },
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
router.post("/upload-bill", upload.single("bill"), async (req, res) => {

  try {

    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const paymentId = Number(req.body.paymentId);
    const file = req.file;

    // =========================
    // VALIDATION
    // =========================
    if (!paymentId || !file) {
      return res.status(400).json({ error: "Missing data" });
    }

    if (isNaN(paymentId)) {
      return res.status(400).json({ error: "Invalid paymentId" });
    }

    // =========================
    // CHECK PAYMENT EXISTS
    // =========================
    const [check] = await db.query(
      "SELECT id FROM payments WHERE id = ?",
      [paymentId]
    );

    if (!check.length) {
      return res.status(404).json({ error: "Payment not found" });
    }

    // =========================
    // UPDATE PAYMENT
    // =========================
    const [result] = await db.query(
      `UPDATE payments 
       SET bill_image = ?, status = 'pending_review'
       WHERE id = ?`,
      [file.filename, paymentId]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({ error: "Update failed" });
    }

    // =========================
    // TELEGRAM (NON-BLOCKING)
    // =========================
    notifyAdmin(paymentId, file.filename);

    return res.json({ success: true });

  } catch (err) {
    console.error("UPLOAD BILL ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;