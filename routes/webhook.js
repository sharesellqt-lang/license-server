const express = require("express");

const router = express.Router();

const db = require("../db");

const {
  getExpireDate
} = require("../services/planService");

router.post(
  "/payment-webhook",
  async (req, res) => {

    try {

      const {
        content,
        transactionId
      } = req.body;

      // 🔥 validate
      if (!content) {

        return res.status(400).json({
          error: "Missing content"
        });

      }

      // 🔥 tìm payment pending
      const [rows] =
        await db.query(
          `
          SELECT *
          FROM payments
          WHERE content = ?
          AND status = 'pending'
          LIMIT 1
          `,
          [content]
        );

      if (!rows.length) {

        return res.json({
          success: false,
          message:
            "Payment not found"
        });

      }

      const payment =
        rows[0];

      // 🔥 chống duplicate webhook
      if (
        payment.status === "paid"
      ) {

        return res.json({
          success: true
        });

      }

      // 🔥 expire sau 30 ngày
      const expireAt =
        getExpireDate(30);

      // 🔥 update user plan
      await db.query(
        `
        UPDATE users
        SET
          plan = ?,
          expire_at = ?
        WHERE id = ?
        `,
        [
          payment.plan,
          expireAt,
          payment.user_id
        ]
      );

      // 🔥 update payment
      await db.query(
        `
        UPDATE payments
        SET
          status = 'paid',
          transaction_id = ?,
          paid_at = NOW()
        WHERE id = ?
        `,
        [
          transactionId || null,
          payment.id
        ]
      );

      console.log(
        "✅ Payment success:",
        payment.id
      );

      return res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error: "Webhook failed"
      });

    }

  }
);

module.exports = router;