const express =
  require("express");

const router =
  express.Router();

const auth =
  require("../middleware/auth");

const db =
  require("../db");

const plans =
  require("../services/planConfig");

// =====================================
// CHECK LIMIT
// =====================================
router.post(
  "/check-limit",

  auth,

  async (req, res) => {

    try {

      const { action } =
        req.body;

      const plan =
        req.user.plan || "free";

      const limit =
        plans[plan]
          ?.limits?.[action];

      // 🔥 unlimited
      if (
        limit === undefined
      ) {

        return res.json({
          allowed: true
        });

      }

      const [rows] =
        await db.query(
          `
          SELECT COUNT(*) as total
          FROM usage_logs
          WHERE user_id = ?
          AND action = ?
          AND DATE(created_at) = CURDATE()
          `,
          [
            req.user.id,
            action
          ]
        );

      const total =
        rows[0].total;

      if (total >= limit) {

        return res.json({

          allowed: false,

          used: total,

          limit,

          plan,

          error:
            "Daily limit reached"

        });

      }

      return res.json({

        allowed: true,

        used: total,

        limit,

        plan

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Check limit failed"
      });

    }

  }
);

// =====================================
// LOG USAGE
// =====================================
router.post(
  "/log-usage",

  auth,

  async (req, res) => {

    try {

      const { action } =
        req.body;

      await db.query(
        `
        INSERT INTO usage_logs
        (
          user_id,
          action
        )
        VALUES (?, ?)
        `,
        [
          req.user.id,
          action
        ]
      );

      return res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Log usage failed"
      });

    }

  }
);

module.exports = router;