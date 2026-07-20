const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");

// =========================
// CONFIG
// =========================
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
console.log("ADMIN_USER =", ADMIN_USER);
console.log("ADMIN_PASS =", ADMIN_PASS);
const JWT_SECRET = process.env.JWT_SECRET || "secret_key";

// =========================
// AUTH MIDDLEWARE
// =========================
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || decoded.role !== "admin") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = decoded;
    next();

  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// =========================
// LOGIN
// =========================
router.post("/login", async (req, res) => {
       console.log("BODY:", req.body);
  console.log("ADMIN_USER:", ADMIN_USER);
  console.log("ADMIN_PASS:", ADMIN_PASS);

  try {
    const { user, pass } = req.body;
    
  console.log("user =", user);
  console.log("pass =", pass);

    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { role: "admin" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      token
    });

  } catch (err) {
    return res.status(500).json({ error: "Login failed" });
  }
});

// =========================
// STATS
// =========================
router.get("/stats", adminAuth, async (req, res) => {
  const [[users]] = await db.query(`SELECT COUNT(*) as total FROM users`);
  const [[payments]] = await db.query(`SELECT COUNT(*) as total FROM payments WHERE status='paid'`);
  const [[revenue]] = await db.query(`SELECT IFNULL(SUM(amount),0) as total FROM payments WHERE status='paid'`);

  res.json({
    users: users.total,
    payments: payments.total,
    revenue: revenue.total
  });
});

// =========================
// USERS
// =========================
router.get("/users", adminAuth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT id, email, plan, expire_at, created_at
    FROM users
    ORDER BY id DESC
  `);

  res.json(rows);
});

// =========================
// PAYMENTS
// =========================
router.get("/payments", adminAuth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT id, user_id, plan, amount, status, created_at
    FROM payments
    ORDER BY id DESC
  `);

  res.json(rows);
});

module.exports = router;