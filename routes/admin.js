const express = require("express");
const router = express.Router();
const db = require("../db"); // Kết nối MySQL
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ==============================
// JWT TOKEN GENERATOR
// ==============================
const SECRET = process.env.JWT_SECRET || "supersecret";

function generateToken(adminId) {
  return jwt.sign({ id: adminId }, SECRET, { expiresIn: '7d' });
}

// =====================================
// ADMIN LOGIN ROUTE
// =====================================
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM admin WHERE username = ?", 
      [username]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const admin = rows[0];

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(admin.id);
    res.json({ success: true, token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// =====================================
// Các route admin khác: users, payments, set-plan, stats...
// =====================================

module.exports = router;
// =====================================
// ADMIN AUTH
// =====================================
function adminAuth(
  req,
  res,
  next
) {

  const token =
    req.headers.token;

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
const bcrypt = require("bcrypt");

// adminAuth, users, payments, set-plan, stats giữ nguyên

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Lấy admin từ database
    const [rows] = await db.query(
      "SELECT * FROM admin WHERE username = ?", 
      [username]
    );

    if (!rows.length)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const admin = rows[0];

    // So sánh password hash
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match){
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // ✅ Tạo token đúng vị trí, chỉ khai báo 1 lần
    const token = generateToken(admin.id);

    // Trả token cho frontend
    res.json({ success: true, token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});
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