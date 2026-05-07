js
const express = require("express");

const router = express.Router();

const auth =
  require("../middleware/auth");

const db =
  require("../db");

// =====================================
// CREATE PAYMENT
// =====================================
router.post(
  "/create-payment",

  auth,

  async (req, res) => {

    try {

      const { plan } =
        req.body;

      const plans = {

        pro: 99000,

        vip: 199000

      };

      if (!plans[plan]) {

        return res.status(400).json({
          error: "Invalid plan"
        });

      }

      const amount =
        plans[plan];

      // =====================================
      // UNIQUE CONTENT
      // =====================================
      const content =
        `USER${req.user.id}_${Date.now()}`;

      // =====================================
      // INSERT PAYMENT
      // =====================================
      const [result] =
        await db.query(
          `
          INSERT INTO payments
          (
            user_id,
            plan,
            amount,
            method,
            status,
            content
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            req.user.id,
            plan,
            amount,
            "bank",
            "pending",
            content
          ]
        );

      // =====================================
      // VIETQR
      // =====================================
      const qrUrl =
        `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-print.png?amount=${amount}&addInfo=${content}`;

      return res.json({

        paymentId:
          result.insertId,

        qrUrl,

        content,

        amount

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          err.message
      });

    }

  }
);

// =====================================
// PAYMENT STATUS
// =====================================
router.get(
  "/payment-status/:id",

  auth,

  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `
          SELECT status
          FROM payments
          WHERE id = ?
          AND user_id = ?
          `,
          [
            req.params.id,
            req.user.id
          ]
        );

      if (!rows.length) {

        return res.status(404).json({
          error:
            "Payment not found"
        });

      }

      return res.json(
        rows[0]
      );

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          err.message
      });

    }

  }
);

// =====================================
// PAYMENT WEBHOOK
// =====================================
router.post(
  "/payment-webhook",

  async (req, res) => {

    try {

      // =====================================
      // WEBHOOK SECRET
      // =====================================
      const secret =
        req.headers[
          "x-webhook-secret"
        ];

      if (
        !secret ||
        secret !==
          process.env.WEBHOOK_SECRET
      ) {

        return res.status(401).json({
          error:
            "Unauthorized"
        });

      }

      const {
        content,
        transactionId
      } = req.body;

      if (
        !content ||
        !transactionId
      ) {

        return res.status(400).json({
          error:
            "Missing content or transactionId"
        });

      }

      // =====================================
      // FIND PAYMENT
      // =====================================
      const [rows] =
        await db.query(
          `
          SELECT *
          FROM payments
          WHERE content = ?
          `,
          [content]
        );

      if (!rows.length) {

        return res.status(404).json({
          error:
            "Payment not found"
        });

      }

      const payment =
        rows[0];

      // =====================================
      // ALREADY PAID
      // =====================================
      if (
        payment.status === "paid"
      ) {

        return res.json({
          success: true
        });

      }

      // =====================================
      // DUPLICATE TRANSACTION
      // =====================================
      const [dup] =
        await db.query(
          `
          SELECT id
          FROM payments
          WHERE transaction_id = ?
          `,
          [transactionId]
        );

      if (dup.length) {

        return res.status(400).json({
          error:
            "Duplicate transaction"
        });

      }

      // =====================================
      // EXPIRE DATE
      // =====================================
      const expireAt =
        new Date(
          Date.now() +
          30 * 24 * 60 * 60 * 1000
        );

      // =====================================
      // UPDATE USER
      // =====================================
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

      // =====================================
      // UPDATE PAYMENT
      // =====================================
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
          transactionId,
          payment.id
        ]
      );

      console.log(
        "PAYMENT PAID:",
        payment.id
      );

      return res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          err.message
      });

    }

  }
);

module.exports =
  router;
