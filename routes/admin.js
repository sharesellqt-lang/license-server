const express = require("express");
const router = express.Router();
const db = require("../db"); // Kết nối MySQL
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");

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

// 🔒 lock từ đây trở xuống
router.use(auth, requireAdmin);
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
  try {
    const paymentId = req.params.id;

    // Lấy payment
    const [rows] = await db.query(
      "SELECT * FROM payments WHERE id = ?",
      [paymentId]
    );

    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: "Not found" });

    // 1. Cập nhật trạng thái payment
await db.query(
  `UPDATE payments
   SET status = 'paid',
       approved_by_admin = 1,
       paid_at = NOW()
   WHERE id = ?`,
  [paymentId]
);

    // 2. Update user plan
const cycle = payment.cycle || "month";

let expireAt = new Date();
if (cycle === "year") {

  expireAt.setFullYear(
    expireAt.getFullYear() + 1
  );

} else {

  expireAt.setMonth(
    expireAt.getMonth() + 1
  );

}

await db.query(
  `UPDATE users
   SET plan = ?,
       expire_at = ?
   WHERE id = ?`,
  [payment.plan, expireAt, payment.user_id]
);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
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

module.exports =
  router;