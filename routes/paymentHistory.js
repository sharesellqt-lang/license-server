const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");

const db = require("../db");

router.get(
  "/payment-history",

  auth,

  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `
          SELECT
            id,
            plan,
            amount,
            status,
            created_at,
            paid_at
          FROM payments
          WHERE user_id = ?
          ORDER BY id DESC
          `,
          [req.user.id]
        );

      return res.json(rows);

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error: "Load history failed"
      });

    }

  }
);

module.exports = router;