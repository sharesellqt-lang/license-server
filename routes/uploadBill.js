const express = require("express");
const multer = require("multer");
const path = require("path");

const router = express.Router();

const auth = require("../middleware/auth");
const db = require("../db");

// =========================
// STORAGE
// =========================
const storage = multer.diskStorage({

  destination(req, file, cb) {

    cb(null, "uploads/");
  },

  filename(req, file, cb) {

    const ext =
      path.extname(file.originalname);

    cb(
      null,
      Date.now() + ext
    );
  }
});

const upload = multer({ storage });

// =========================
// UPLOAD BILL
// =========================
router.post(
  "/upload-bill",

  auth,

  upload.single("bill"),

  async (req, res) => {
  console.log("BODY:", req.body);
  console.log("FILE:", req.file);

    try {

      const paymentId =
        req.body.paymentId;

      if (!paymentId) {
        return res.status(400).json({
          error: "Missing paymentId"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No image"
        });
      }

      // =====================
      // UPDATE PAYMENT
      // =====================
      await db.query(`
        UPDATE payments
        SET bill_image = ?,
            status = 'review'
        WHERE id = ?
      `, [
        req.file.filename,
        paymentId
      ]);

      return res.json({
        success: true
      });

    } catch (err) {

      console.error("UPLOAD ERROR:", err);

      return res.status(500).json({
        error: err.message
      });
    }
  }
);

module.exports = router;