const jwt = require("jsonwebtoken");

const db = require("../db");

module.exports = async (req, res, next) => {

  try {

    // =========================
    // AUTH HEADER
    // =========================
    const authHeader =
      req.headers.authorization;

    if (!authHeader) {

      return res.status(401).json({
        error: "No token"
      });

    }

    // =========================
    // TOKEN
    // =========================
    const token =
      authHeader.split(" ")[1];

    if (!token) {

      return res.status(401).json({
        error: "Invalid token"
      });

    }

    // =========================
    // VERIFY JWT
    // =========================
    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    // =========================
    // GET USER REALTIME
    // =========================
    const [rows] =
      await db.query(
        `
        SELECT
          id,
          plan,
          expire_at
        FROM users
        WHERE id = ?
        `,
        [decoded.id]
      );

    // =========================
    // USER NOT FOUND
    // =========================
    if (!rows.length) {

      return res.status(401).json({
        error: "User not found"
      });

    }

    const user = rows[0];

    // =========================
    // DEFAULT PLAN
    // =========================
    let plan =
      user.plan || "free";

    // =========================
    // AUTO EXPIRE
    // =========================
    if (
      user.expire_at &&
      new Date(user.expire_at) < new Date()
    ) {

      await db.query(
        `
        UPDATE users
        SET
          plan = 'free',
          expire_at = NULL
        WHERE id = ?
        `,
        [user.id]
      );

      plan = "free";

      user.expire_at = null;

    }

    // =========================
    // ATTACH USER
    // =========================
    req.user = {
      id: user.id,
      plan,
      expireAt:
        user.expire_at
    };

    next();

  } catch (err) {

    console.error(err);

    return res.status(401).json({
      error: "Invalid token"
    });

  }

};