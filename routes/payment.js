const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");

const db = require("../db");

router.post(
  "/create-payment",
  auth,
  async (req, res) => {

    try {

      const { plan } = req.body;

      const plans = {
        pro: 99000,
        vip: 199000
      };

      if (!plans[plan]) {
        return res.status(400).json({
          error: "Invalid plan"
        });
      }

      const amount = plans[plan];

      const content =
        `UPGRADE_${req.user.id}_${Date.now()}`;

      const [result] = await db.query(
        `
        INSERT INTO payments
        (
          userId,
          plan,
          amount,
          content
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          req.user.id,
          plan,
          amount,
          content
        ]
      );

      const qrUrl =
        `https://img.vietqr.io/image/970422-123456789-print.png?amount=${amount}&addInfo=${content}`;

      res.json({
        paymentId: result.insertId,
        qrUrl,
        content,
        amount
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: "Create payment failed"
      });

    }

  }
);

module.exports = router;

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
          `,
          [req.params.id]
        );

      if (!rows.length) {

        return res
          .status(404)
          .json({
            error:
              "Payment not found"
          });

      }

      res.json(rows[0]);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          "Payment status failed"
      });

    }

  }
);