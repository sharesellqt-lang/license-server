console.log("################################");
console.log("AUTH ROUTE LOADED");
console.log("################################");
const authMiddleware = require("../middleware/auth");
const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();

const db = require("../db");

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);
const loginRewardService = require("../services/rewards.login.service");
const referralService = require("../services/rewards.referral.service");
// =========================
// GOOGLE LOGIN
// =========================
router.post(
  "/google-login",
  async (req, res) => {

    try {

      const { credential, referralCode } = req.body;

      if (!credential) {
        return res.status(400).json({
          error: "Missing credential"
        });
      }

      // 🔥 verify google token
      const ticket =
        await client.verifyIdToken({

          idToken:
            credential,

          audience:
            process.env.GOOGLE_CLIENT_ID

        });

      const payload =
        ticket.getPayload();

      const email =
        payload.email;

      const googleId =
        payload.sub;

      // =========================
      // FIND USER
      // =========================
      const [rows] =
        await db.query(
          `
          SELECT *
          FROM users
          WHERE email = ?
          `,
          [email]
        );

      let user;
      let isNewUser = false;

      // =========================
      // CREATE USER
      // =========================
      if (!rows.length) {

        const [result] =
          await db.query(
            `
            INSERT INTO users
            (
              email,
              google_id,
              plan
            )
            VALUES (?, ?, ?)
            `,
            [
              email,
              googleId,
              "free"
            ]
          );

        user = {
            id: result.insertId,
            email,
            plan: "free"
        };

        isNewUser = true;

      } else {

        user = rows[0];

      }

      // =========================
// LOGIN REWARD
// =========================
try {
    const rewardResult = await loginRewardService.recordLogin(user.id);

    console.log("[LOGIN REWARD]", {
        userId: user.id,
        ...rewardResult
    });
} catch (rewardError) {
    console.error("[LOGIN REWARD ERROR]", {
        userId: user.id,
        error: rewardError.message
    });
}

// =========================
// REFERRAL
// =========================
try {
    const referralResult = await referralService.processGoogleLogin({
        userId: user.id,
        isNewUser,
        referralCode
    });

    console.log("[REFERRAL]", {
        userId: user.id,
        isNewUser,
        ...referralResult
    });
} catch (referralError) {
    console.error("[REFERRAL ERROR]", {
        userId: user.id,
        error: referralError.message
    });
}
      // =========================
      // JWT
      // =========================
      const token =
        jwt.sign(

          {
            id: user.id
          },

          process.env.JWT_SECRET,

          {
            expiresIn: "30d"
          }

        );

      return res.json({
        token
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Google login failed"
      });

    }

  }
);

router.get("/me", authMiddleware, async (req, res) => {

    try {

        const [rows] = await db.execute(
            `
            SELECT
                id,
                plan,
                cycle,
                created_at,
                expire_at
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [req.user.id]
        );

        if (!rows.length) {

            return res.status(404).json({
                error: "USER_NOT_FOUND"
            });

        }

        const user = rows[0];

        let plan =
            String(user.plan || "free")
                .trim()
                .toLowerCase();

        if (
            user.expire_at &&
            new Date() > new Date(user.expire_at)
        ) {

            plan = "free";

        }

        const now =
            new Date();

        const expireAt =
            user.expire_at
                ? new Date(user.expire_at)
                : null;

        const isActive =
            expireAt &&
            expireAt > now;

        const daysLeft =
            expireAt
                ? Math.max(
                    0,
                    Math.ceil(
                        (expireAt - now) /
                        (1000 * 60 * 60 * 24)
                    )
                )
                : 0;

        return res.json({

            id: user.id,

            licensed:
                plan !== "free",

            isActive,

            daysLeft,

            plan,

            cycle:
                user.cycle || "month",

            expireAt:
                user.expire_at || null

        });

    }
    catch (err) {

        console.error("ME ERROR:", err);

        return res.status(500).json({

            error: "SERVER_ERROR"

        });

    }

});

module.exports = router;