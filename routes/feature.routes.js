const express = require("express");

const router = express.Router();

const authMiddleware =
require("../middleware/auth");

const db =
require("../db");

const permissions =
require("../permissions/tool.permissions");
console.log(
  "PERMISSIONS =",
  permissions
);

const {
  canAccessFeature
} = require(
  "../services/feature.service"
);

/* =====================================
   ACTIVATE FEATURE TRIAL
===================================== */

router.post(
  "/activate-feature-trial",
  authMiddleware,

async (req, res) => {

  try {

    const { feature } = req.body;

    const config =
      permissions.features[
        feature
      ];

    if (!config) {

      return res
        .status(400)
        .json({
          error: "Invalid feature"
        });

    }

    const [[user]] =
      await db.query(
        "SELECT * FROM users WHERE id = ?",
        [req.user.id]
      );

    if (!user) {

      return res
        .status(404)
        .json({
          error: "User not found"
        });

    }

    // Kiểm tra trial còn hiệu lực hay không
    const [activeTrials] =
      await db.query(
        `
        SELECT id
        FROM user_feature_trials
        WHERE user_id = ?
          AND feature_key = ?
          AND is_active = 1
          AND expires_at > NOW()
        LIMIT 1
        `,
        [
          req.user.id,
          feature
        ]
      );

    if (activeTrials.length > 0) {

      return res
        .status(400)
        .json({
          error: "Trial already active"
        });

    }

    const expiresAt =
      new Date(
        Date.now() +
        config.trialDays *
        24 *
        60 *
        60 *
        1000
      );

    await db.query(
      `
      INSERT INTO user_feature_trials
      (
        user_id,
        feature_key,
        required_plan,
        activated_at,
        expires_at,
        is_active
      )
      VALUES (?, ?, ?, NOW(), ?, 1)
      `,
      [
        req.user.id,
        feature,
        config.requiredPlan,
        expiresAt
      ]
    );

    return res.json({

      success: true,

      feature,

      expiresAt

    });

  } catch (err) {

    console.error(
      "ACTIVATE TRIAL ERROR:",
      err
    );

    return res
      .status(500)
      .json({
        error: err.message
      });

  }

}

);

/* =====================================
   FEATURE ACCESS -update
===================================== */

router.get(
  "/feature-access",
  authMiddleware,

  async (req, res) => {

    try {

      const feature =
        req.query.feature;

      if (!feature) {

        return res
          .status(400)
          .json({

            allowed: false

          });

      }

      const [[user]] =
        await db.query(
          "SELECT * FROM users WHERE id = ?",
          [req.user.id]
        );

      if (!user) {

        return res.json({

          allowed: false

        });

      }

    const allowed = await canAccessFeature(user, feature);

      return res.json({

        allowed

      });

    } catch (err) {

      console.error(err);

      return res
        .status(500)
        .json({

          allowed: false

        });

    }

  }

);

module.exports =
router;