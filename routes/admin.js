const express = require("express");
const router = express.Router();
const db = require("../db"); // Kết nối MySQL
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ==============================
// JWT TOKEN GENERATOR
// ==============================
const SECRET = process.env.JWT_SECRET || "supersecret";

// =====================================
// Các route admin khác: users, payments, set-plan, stats...
// =====================================

// =====================================
// ADMIN AUTH
// =====================================

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization; // Bearer <token>
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.adminId = decoded.adminId; // gán adminId nếu cần dùng
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Hàm tạo token login
function generateToken(adminId) {
  return jwt.sign({ adminId }, SECRET, { expiresIn: "8h" });
}

// =====================================
// ADMIN LOGIN
// =====================================

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

// APPROVE PAYMENT
router.post("/payments/:id/approve", adminAuth, async (req, res) => {
  const paymentId = req.params.id;

  try {
    console.log("👉 APPROVE START:", paymentId);

    const [rows] = await db.query(
      "SELECT * FROM payments WHERE id = ?",
      [paymentId]
    );

    if (!rows.length) {
      console.log("❌ PAYMENT NOT FOUND");
      return res.status(404).json({ error: "Not found" });
    }

    const payment = rows[0];
    console.log("PAYMENT:", payment);

    const { PLANS } = require("../plans");
    const planData = PLANS[payment.plan];

    if (!planData) {
      console.log("❌ INVALID PLAN:", payment.plan);
      return res.status(400).json({ error: "Invalid plan" });
    }

    const cycle = payment.cycle || "month";

    const days =
      cycle === "year"
        ? planData.durationDays * 12
        : planData.durationDays;

    const expireAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000
    );

    console.log("➡️ EXPIRE:", expireAt);

    await db.query(
      `UPDATE payments SET status='paid', approved_by_admin=1, paid_at=NOW() WHERE id=?`,
      [paymentId]
    );

    await db.query(
      `UPDATE users SET plan=?, expire_at=? WHERE id=?`,
      [payment.plan, expireAt, payment.user_id]
    );

    console.log("✅ APPROVE SUCCESS");

    res.json({ success: true });

  } catch (err) {
    console.error("🔥 APPROVE ERROR:", err);
    res.status(500).json({ error: "Approve failed" });
  }
});

// REJECT PAYMENT
router.post("/payments/:id/reject", adminAuth, async (req, res) => {
  try {
    const paymentId = req.params.id;

    await db.query(`
  UPDATE payments
  SET status = 'rejected'
  WHERE id = ?
`, [paymentId]);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Reject failed" });
  }
});

// =====================================
// SET PLAN
// =====================================
router.post(
  "/set-plan",
  adminAuth,
  async (req, res) => {
    try {
      const { userId, plan } = req.body;

      if (!userId || !plan) {
        return res.status(400).json({
          error: "Missing userId or plan"
        });
      }

      // load plan config (source of truth)
      const planData = require("../plans").PLANS[plan];

      if (!planData) {
        return res.status(400).json({
          error: "Invalid plan"
        });
      }

      // duration chuẩn từ PLANS
      const cycle = payment.cycle || "month";

      const days =
      cycle === "year"
    ? planData.durationDays * 12
    : planData.durationDays;

      const expireAt = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000
      );

      await db.query(
        `
        UPDATE users
        SET
          plan = ?,
          expire_at = ?
        WHERE id = ?
        `,
        [plan, expireAt, userId]
      );

      return res.json({
        success: true,
        plan,
        expireAt
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: "Set plan failed"
      });
    }
  }
);

// =====================================
// STATS
// =====================================

module.exports =
  router;