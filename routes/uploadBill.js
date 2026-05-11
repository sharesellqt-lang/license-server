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

// =========================
// UPLOAD BILL
// =========================
router.post("/upload-bill", async (req, res) => {

  const { paymentId } = req.body;
  const file = req.file;

  if (!paymentId || !file) {
    return res.status(400).json({ error: "Missing data" });
  }

  // save to DB
  await db.query(
    `UPDATE payments 
     SET bill_image = ?, status = 'pending_review'
     WHERE id = ?`,
    [file.filename, paymentId]
  );

  // notify admin
  await notifyAdmin(paymentId, file.filename);

  res.json({ success: true });
});

module.exports = router;