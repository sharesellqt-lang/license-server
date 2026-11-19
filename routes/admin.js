const express = require("express");
const router = express.Router();
const db = require("../db"); // Kết nối MySQL
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const requirePermission = require("../middleware/requirePermission");
const planService = require("../services/planService");

// JWT TOKEN GENERATOR
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
    throw new Error("JWT_SECRET is not configured");
}

// =====================================
// Các route admin khác: users, payments, set-plan, stats...
// =====================================

// =====================================
// ADMIN AUTH
// =====================================

async function adminAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const token = authHeader.slice(7).trim();
        const decoded = jwt.verify(token, SECRET);

        if (!decoded.adminId) {
            return res.status(403).json({ error: "Admin token required" });
        }

        const [rows] = await db.query(
            "SELECT id FROM admin WHERE id = ? LIMIT 1",
            [decoded.adminId]
        );

        if (!rows.length) {
            return res.status(401).json({ error: "Admin account not found" });
        }

        req.adminId = rows[0].id;
        next();

    } catch (err) {
        if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        console.error("ADMIN AUTH ERROR:", err.message);
        return res.status(500).json({ error: "Admin authentication failed" });
    }
}

// =====================================
// ENGLISH LEARNING CMS
// =====================================

const createEnglishLearningAdminRouter =
    require("./admin.english-learning");

router.use(
    "/english-learning",
    adminAuth,
    requirePermission("lessons:manage"),
    createEnglishLearningAdminRouter((req, res, next) => next())
);

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
    const { username, password } = req.body || {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required"
      });
    }

    // Lấy admin từ database

    const [rows] = await db.query(
      "SELECT * FROM admin WHERE username = ?", 
      [username]
    );


   if (!rows.length) {
    return res.status(401).json({
        success: false,
        message: "Invalid credentials"
    });
}

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



// =====================================================
// APPROVE PAYMENT
// =====================================================
router.post("/payments/:id/approve", adminAuth, async (req, res) => {
  let connection;

  try {
    const paymentId = Number(req.params.id);

    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Lock payment
    const [rows] = await connection.execute(
      `SELECT *
       FROM payments
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [paymentId]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Payment not found" });
    }

    const payment = rows[0];

    // 2. Prevent duplicate approval
    if (
      payment.status === "paid" &&
      Number(payment.approved_by_admin) === 1
    ) {
      await connection.commit();

      return res.json({
        success: true,
        message: "Payment already processed",
        duplicate: true
      });
    }

    if (!["pending", "pending_review"].includes(payment.status)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        error: "PAYMENT_NOT_PENDING"
      });
    }

    // 3. Validate payment
    const plan = String(payment.plan || "").trim().toLowerCase();
    const cycle = String(payment.cycle || "month").trim().toLowerCase();

    if (
  !payment.user_id ||
  !["pro", "vip"].includes(plan) ||
  !["month", "year"].includes(cycle) ||
  !Number.isFinite(Number(payment.amount)) ||
  Number(payment.amount) < 0
) {
  throw new Error("INVALID_PAYMENT_DATA");
}

    // 4. Read payment snapshot
    let paymentSnapshot = {};

    if (payment.plan_snapshot) {
      try {
        paymentSnapshot = typeof payment.plan_snapshot === "object"
          ? payment.plan_snapshot
          : JSON.parse(payment.plan_snapshot);
      } catch {
        throw new Error("INVALID_PAYMENT_SNAPSHOT");
      }
    }

    const paymentType = paymentSnapshot.type || "purchase";
const paymentAmount = Number(payment.amount);

let planResult;

// Chỉ cho phép payment 0 đồng nếu PRO Credit đủ thanh toán VIP.
if (paymentAmount === 0) {
  const validCreditUpgrade =
    paymentType === "upgrade" &&
    paymentSnapshot.fromPlan === "pro" &&
    paymentSnapshot.toPlan === "vip" &&
    paymentSnapshot.paidByProCredit === true &&
    paymentSnapshot.requiresAdminApproval === true &&
    Number.isFinite(Number(paymentSnapshot.vipPrice)) &&
    Number.isFinite(Number(paymentSnapshot.appliedProCredit)) &&
    Number(paymentSnapshot.appliedProCredit) >= Number(paymentSnapshot.vipPrice);

  if (!validCreditUpgrade) {
    throw new Error("INVALID_ZERO_AMOUNT_PAYMENT");
  }
}

    // 5. Apply correct plan operation
    if (paymentType === "upgrade") {
      if (
        paymentSnapshot.fromPlan !== "pro" ||
        paymentSnapshot.toPlan !== "vip" ||
        plan !== "vip" ||
        !Number.isFinite(Number(paymentSnapshot.originalExpireMs))
      ) {
        throw new Error("INVALID_UPGRADE_PAYMENT");
      }

      planResult = await planService.upgradePlan(connection, {
        userId: payment.user_id,
        cycle,
        expectedExpireMs: paymentSnapshot.originalExpireMs
      });

    } else if (
      paymentType === "purchase" ||
      paymentType === "renewal"
    ) {
      planResult = await planService.applyPlan(connection, {
        userId: payment.user_id,
        plan,
        durationMonths: cycle === "year" ? 12 : 1,
        durationDays: 0,
        cycle,
        allowDowngrade: false
      });

    } else {
      throw new Error("INVALID_PAYMENT_TYPE");
    }

    // 6. Preserve original calculation snapshot
    const planSnapshot = JSON.stringify({
      ...paymentSnapshot,
      type: paymentType,
      plan,
      cycle,
      paymentId: payment.id,
      amount: Number(payment.amount),
      source: "admin_approval",
      approvedBy: req.adminId,
      planBefore: planResult.planBefore,
      planAfter: planResult.planAfter,
      previousExpireAt: planResult.previousExpireAt || null,
      planStartDate: planResult.planStartDate || null,
      expireAt: planResult.expireAt
    });

    // 7. Update payment
    const [updateResult] = await connection.execute(
      `UPDATE payments
       SET status = 'paid',
           approved_by_admin = 1,
           paid_at = NOW(),
           plan_start_date = ?,
           expire_at = ?,
           plan_snapshot = ?
       WHERE id = ?
         AND status IN ('pending', 'pending_review')`,
      [
        planResult.planStartDate || null,
        planResult.expireAt,
        planSnapshot,
        paymentId
      ]
    );

    if (!updateResult.affectedRows) {
      throw new Error("PAYMENT_UPDATE_FAILED");
    }


// 8. Record first-purchase referral attribution
if (paymentType === "purchase" && paymentAmount > 0) {
  // Lock referral relation of the buyer
  const [referralRows] = await connection.execute(
    `SELECT *
     FROM reward_referrals
     WHERE referred_user_id = ?
       AND status = 'pending'
       AND first_purchase_payment_id IS NULL
     LIMIT 1
     FOR UPDATE`,
    [payment.user_id]
  );

  if (referralRows.length) {
    const referral = referralRows[0];

    // Read referral reward rule
    const [ruleRows] = await connection.execute(
      `SELECT enabled, credits, config
       FROM reward_rules
       WHERE rule_key = 'referral_first_purchase'
       LIMIT 1
       FOR UPDATE`
    );

    if (!ruleRows.length) {
      throw new Error("REFERRAL_REWARD_RULE_NOT_FOUND");
    }

    const rule = ruleRows[0];

    let ruleConfig = {};
    try {
      ruleConfig = typeof rule.config === "object"
        ? rule.config
        : JSON.parse(rule.config || "{}");
    } catch {
      throw new Error("INVALID_REFERRAL_REWARD_CONFIG");
    }

    const enabled = Number(rule.enabled) === 1;
    const credits = Math.max(0, Math.floor(Number(rule.credits) || 0));
    const waitDays = Math.max(
      0,
      Math.floor(Number(ruleConfig.wait_days) || 0)
    );

    const rewardActive = enabled && credits > 0;
    const attributionStatus = !rewardActive
      ? "cancelled"
      : waitDays > 0
        ? "waiting"
        : "eligible";

    const eligibleAt = rewardActive
      ? `DATE_ADD(NOW(), INTERVAL ${waitDays} DAY)`
      : "NULL";

    // Create attribution record
    await connection.execute(
      `INSERT INTO reward_attributions (
         payment_id,
         source_type,
         referral_id,
         referrer_user_id,
         referred_user_id,
         status,
         reward_credits,
         wait_days,
         eligible_at,
         metadata
       ) VALUES (?, 'referral', ?, ?, ?, ?, ?, ?, ${eligibleAt}, ?)`,
      [
        paymentId,
        referral.id,
        referral.referrer_user_id,
        referral.referred_user_id,
        attributionStatus,
        rewardActive ? credits : 0,
        waitDays,
        JSON.stringify({
          rule_key: "referral_first_purchase",
          rule_enabled: enabled,
          purchase_policy: ruleConfig.purchase_policy || null,
          payment_type: paymentType,
          payment_amount: paymentAmount,
          reason: rewardActive ? null : "reward_rule_disabled_or_zero_credits"
        })
      ]
    );

    // Mark the referred user's first purchase
   const [referralUpdate] = await connection.execute(
  `UPDATE reward_referrals
   SET first_purchase_payment_id = ?,
       status = ?,
       qualified_at = NOW(),
       rejection_reason = ?
   WHERE id = ?
     AND first_purchase_payment_id IS NULL`,
  [
    paymentId,
    rewardActive ? "qualified" : "rejected",
    rewardActive ? null : "Reward rule disabled or credits not configured",
    referral.id
  ]
);

if (!referralUpdate.affectedRows) {
  throw new Error("REFERRAL_FIRST_PURCHASE_UPDATE_FAILED");
}

    console.log("REFERRAL ATTRIBUTION RECORDED:", {
      paymentId,
      referralId: referral.id,
      referrerUserId: referral.referrer_user_id,
      referredUserId: referral.referred_user_id,
      status: attributionStatus,
      credits: rewardActive ? credits : 0,
      waitDays
    });
  }
}

    await connection.commit();

    console.log("ADMIN PAYMENT APPROVED:", {
      paymentId,
      userId: payment.user_id,
      adminId: req.adminId,
      paymentType,
      plan: planResult.planAfter,
      cycle,
      expireAt: planResult.expireAt
    });

    return res.json({
      success: true,
      message: "Payment approved",
      paymentId,
      paymentType,
      plan: planResult.planAfter,
      expireAt: planResult.expireAt
    });

  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("APPROVE ROLLBACK ERROR:", rollbackError.message);
      }
    }

    console.error("APPROVE PAYMENT ERROR:", err);

    const clientErrors = [
      "INVALID_PAYMENT_DATA",
      "INVALID_PAYMENT_SNAPSHOT",
      "INVALID_UPGRADE_PAYMENT",
      "INVALID_PAYMENT_TYPE",
      "PLAN_DOWNGRADE_NOT_ALLOWED",
      "UPGRADE_SOURCE_PLAN_INVALID",
      "PLAN_EXPIRED",
      "UPGRADE_CYCLE_MISMATCH",
      "UPGRADE_QUOTE_EXPIRED",
      "USER_NOT_FOUND",
      "INVALID_ZERO_AMOUNT_PAYMENT",
    
    ];

    return res.status(clientErrors.includes(err.message) ? 400 : 500).json({
      success: false,
      error: "Approve failed",
      code: err.message || "UNKNOWN_ERROR"
    });

  } finally {
    if (connection) connection.release();
  }
});


// REJECT PAYMENT
router.post("/payments/:id/reject", adminAuth, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        error: "INVALID_PAYMENT_ID"
      });
    }

    const [result] = await db.execute(
      `UPDATE payments
       SET status = 'rejected'
       WHERE id = ?
         AND status IN ('pending', 'pending_review')
         AND approved_by_admin = 0`,
      [paymentId]
    );

    if (!result.affectedRows) {
      return res.status(409).json({
        success: false,
        error: "PAYMENT_NOT_PENDING"
      });
    }

    return res.json({
      success: true,
      message: "Payment rejected",
      paymentId
    });

  } catch (err) {
    console.error("REJECT PAYMENT ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "REJECT_PAYMENT_FAILED"
    });
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