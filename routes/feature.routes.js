const express = require("express");

const router = express.Router();

const authMiddleware =
require("../middleware/auth");

const db =
require("../db");

const permissions =
require("../permissions/tool.permissions");

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

      const { feature } =
        req.body;

      const config =
        permissions.features[
          feature
        ];

      if (!config) {

        return res
          .status(400)
          .json({

            error:
              "Invalid feature"

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

            error:
              "User not found"

          });

      }

      const currentTrialFeature =
        user.active_trial_feature;

      const currentTrialExpire =
        user.active_trial_expire;

      const stillActive =

        currentTrialFeature ===
          feature &&

        currentTrialExpire &&

        new Date(
          currentTrialExpire
        ) > new Date();

      if (stillActive) {

        return res
          .status(400)
          .json({

            error:
              "Trial already active"

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
        UPDATE users
        SET
          active_trial_feature = ?,
          active_trial_expire = ?
        WHERE id = ?
        `,
        [
          feature,
          expiresAt,
          req.user.id
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
   FEATURE ACCESS
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

      const allowed =

        canAccessFeature(
          user,
          feature
        );

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