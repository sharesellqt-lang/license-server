const express =
  require("express");

const router =
  express.Router();

const db =
  require("../db");

// =====================================
// ADMIN CONFIG
// =====================================
const ADMIN_USER =
  process.env.ADMIN_USER;

const ADMIN_PASS =
  process.env.ADMIN_PASS;

const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN;

// =====================================
// ADMIN AUTH
// =====================================
function adminAuth(
  req,
  res,
  next
) {

 const token = req.headers.authorization?.replace("Bearer ", "");

  if (
    !token ||
    token !== ADMIN_TOKEN
  ) {

    return res.status(401).json({
      error: "Unauthorized"
    });

  }

  next();

}

// =====================================
// ADMIN LOGIN
// =====================================
router.post(
  "/login",

  async (req, res) => {

    try {

      const {
        user,
        pass
      } = req.body;

      if (
        user !== ADMIN_USER ||
        pass !== ADMIN_PASS
      ) {

        return res.status(401).json({
          error:
            "Invalid credentials"
        });

      }

      return res.json({

        success: true,

        token:
          ADMIN_TOKEN

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Admin login failed"
      });

    }

  }
);

// =====================================
// LIST USERS
// =====================================
router.get(
  "/users",

  adminAuth,

  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `
          SELECT
            id,
            email,
            plan,
            expire_at,
            created_at
          FROM users
          ORDER BY id DESC
          `
        );

      return res.json(rows);

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Load users failed"
      });

    }

  }
);

// =====================================
// LIST PAYMENTS
// =====================================
router.get(
  "/payments",

  adminAuth,

  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `
          SELECT
            id,
            user_id,
            plan,
            amount,
            status,
            transaction_id,
            created_at,
            paid_at
          FROM payments
          ORDER BY id DESC
          `
        );

      return res.json(rows);

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Load payments failed"
      });

    }

  }
);

// =====================================
// SET PLAN
// =====================================
router.post(
  "/set-plan",

  adminAuth,

  async (req, res) => {

    try {

      const {
        userId,
        plan,
        days
      } = req.body;

      const expireAt =
        new Date(
          Date.now() +
          (
            Number(days || 30)
            * 24
            * 60
            * 60
            * 1000
          )
        );

      await db.query(
        `
        UPDATE users
        SET
          plan = ?,
          expire_at = ?
        WHERE id = ?
        `,
        [
          plan,
          expireAt,
          userId
        ]
      );

      return res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Set plan failed"
      });

    }

  }
);

// =====================================
// STATS
// =====================================
router.get(
  "/stats",

  adminAuth,

  async (req, res) => {

    try {

      const [[users]] =
        await db.query(
          `
          SELECT
            COUNT(*) as total
          FROM users
          `
        );

      const [[payments]] =
        await db.query(
          `
          SELECT
            COUNT(*) as total
          FROM payments
          WHERE status = 'paid'
          `
        );

      const [[revenue]] =
        await db.query(
          `
          SELECT
            IFNULL(
              SUM(amount),
              0
            ) as total
          FROM payments
          WHERE status = 'paid'
          `
        );

      return res.json({

        users:
          users.total,

        payments:
          payments.total,

        revenue:
          revenue.total

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error:
          "Load stats failed"
      });

    }

  }
);

module.exports =
  router;
