const express = require("express");
const router = express.Router();

const db = require("../db");

// =========================
// GLOBAL FEATURE RULES
// =========================

const FEATURE_RULES = {

  proMode: {
    requiredPlan: "pro",
    trialDays: 3
  },

  vipMode: {
    requiredPlan: "vip",
    trialDays: 1
  }

};

// =========================
// PLAN RANK
// =========================

const PLAN_RANK = {
  free: 0,
  pro: 1,
  vip: 2
};

// =========================
// FEATURE ACCESS
// =========================

router.get(
  "/feature-access",
  async (req, res) => {

    try {

      const {
        userId,
        feature
      } = req.query;

      if (!userId || !feature) {

        return res.json({
          allowed: false
        });

      }

      const config =
        FEATURE_RULES[feature];

      if (!config) {

        return res.json({
          allowed: false
        });

      }

      // =====================
      // USER PLAN
      // =====================

      const users =
        await db.query(
          `
          SELECT plan
          FROM users
          WHERE id=?
          `,
          [userId]
        );

      const plan =
        (
          users[0]?.plan ||
          "free"
        )
          .toLowerCase();

      // =====================
      // NORMAL PLAN ACCESS
      // =====================

      if (

        PLAN_RANK[plan] >=
        PLAN_RANK[
          config.requiredPlan
        ]

      ) {

        return res.json({

          allowed: true,
          source: "plan"

        });

      }

      // =====================
      // FEATURE TRIAL
      // =====================

      const trials =
        await db.query(
          `
          SELECT *
          FROM user_feature_trials
          WHERE user_id=?
          AND feature_key=?
          AND expires_at > NOW()
          LIMIT 1
          `,
          [
            userId,
            feature
          ]
        );

      if (trials.length) {

        return res.json({

          allowed: true,
          source: "trial"

        });

      }

      // =====================
      // BLOCK
      // =====================

      return res.json({

        allowed: false,
        requiredPlan:
          config.requiredPlan

      });

    }

    catch (err) {

      console.error(
        "FEATURE ACCESS ERROR:",
        err
      );

      return res.status(500).json({

        allowed: false

      });

    }

  }
);

module.exports = router;