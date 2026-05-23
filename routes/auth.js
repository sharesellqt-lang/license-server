const authMiddleware = require("../middleware/auth");
const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();

const db = require("../db");

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

// =========================
// GOOGLE LOGIN
// =========================
router.post(
  "/google-login",
  async (req, res) => {

    try {

      const { credential } =
        req.body;

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

      } else {

        user = rows[0];

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

    res.json({
      success: true,
      user: req.user
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false
    });

  }

});

module.exports = router;