const upload = require("../middleware/upload");
const express = require("express");
const router = express.Router();
const db = require("../db");
const axios = require("axios");

// =========================
// TELEGRAM CONFIG
// =========================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// =========================
// SEND TELEGRAM NOTIFY
// =========================
async function notifyAdmin(paymentId, filePath) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const message = `
🧾 NEW PAYMENT BILL UPLOADED
Payment ID: ${paymentId}
File: ${filePath}
  `;

  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  });
}

router.post("/upload-bill", upload.single("bill"), async (req, res) => {

  try {

    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const { paymentId } = req.body;
    const file = req.file;

    if (!paymentId || !file) {
      return res.status(400).json({ error: "Missing data" });
    }

    // =========================
    // UPDATE PAYMENT
    // =========================
    await db.query(
      `UPDATE payments 
       SET bill_image = ?, status = 'pending_review'
       WHERE id = ?`,
      [file.filename, paymentId]
    );

    // =========================
    // TELEGRAM NOTIFY
    // =========================
    await notifyAdmin(paymentId, file.filename);

    return res.json({ success: true });

  } catch (err) {
    console.error("UPLOAD BILL ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;