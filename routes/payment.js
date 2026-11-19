"use strict";

const express = require("express");
const router = express.Router();

if (!process.env.BANK_ID || !process.env.BANK_ACCOUNT) {
  throw new Error("Missing BANK_ID or BANK_ACCOUNT in .env");
}

const auth = require("../middleware/auth");
const db = require("../db");
const { getPlan, getPlanPrice } = require("./plans");

function buildPaymentNote(userId, paymentId) {
  return `USER_${userId}_${paymentId}`;
}

function getBankInfo() {
  return {
    name: process.env.BANK_NAME?.trim() || "",
    account: process.env.BANK_ACCOUNT.trim(),
    owner: process.env.BANK_OWNER?.trim() || ""
  };
}

function parseSnapshot(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// Tìm toàn bộ chuỗi thanh toán PRO liên tiếp tạo nên hạn hiện tại.
// Chỉ tính các giao dịch đã thanh toán và đã được duyệt.

async function getProSubscriptionBasis(connection, user) {
  const currentExpiryMs = Number(user.expire_ms);
  const nowMs = Number(user.now_ms);

  if (!currentExpiryMs || !nowMs || currentExpiryMs <= nowMs) {
    throw new Error("PRO_SUBSCRIPTION_EXPIRED");
  }

  const [payments] = await connection.execute(
    `SELECT id, amount,
            UNIX_TIMESTAMP(plan_start_date) * 1000 AS start_ms,
            UNIX_TIMESTAMP(expire_at) * 1000 AS end_ms
     FROM payments
     WHERE user_id = ?
       AND plan = 'pro'
       AND cycle = ?
       AND status = 'paid'
       AND approved_by_admin = 1
       AND plan_start_date IS NOT NULL
       AND expire_at IS NOT NULL
     ORDER BY expire_at DESC, id DESC`,
    [user.id, user.cycle]
  );

  let cursorMs = currentExpiryMs;
  let totalDurationMs = 0;
  let totalPaid = 0;
  let oldestStartMs = null;
  let count = 0;
  const usedIds = new Set();

  while (true) {
    const candidates = payments.filter(payment =>
      !usedIds.has(Number(payment.id)) &&
      Math.abs(Number(payment.end_ms) - cursorMs) <= 2000
    );

    if (candidates.length > 1) {
      throw new Error("AMBIGUOUS_PRO_PAYMENT_HISTORY");
    }

    if (!candidates.length) break;

    const payment = candidates[0];
    const startMs = Number(payment.start_ms);
    const endMs = Number(payment.end_ms);
    const paid = Number(payment.amount);

    if (
      !startMs ||
      !endMs ||
      endMs <= startMs ||
      startMs > cursorMs ||
      !Number.isFinite(paid) ||
      paid <= 0
    ) {
      throw new Error("INVALID_PRO_PAYMENT_HISTORY");
    }

    usedIds.add(Number(payment.id));

    totalDurationMs += endMs - startMs;
    totalPaid += paid;
    oldestStartMs = startMs;
    cursorMs = startMs;
    count++;
  }

  if (!count || !totalDurationMs || !totalPaid) {
    throw new Error("PRO_PAYMENT_HISTORY_NOT_FOUND");
  }

  const remainingMs = Math.max(0, currentExpiryMs - nowMs);
  const remainingRatio = Math.min(1, remainingMs / totalDurationMs);

  return {
    cycle: user.cycle,
    planStartMs: oldestStartMs,
    expireMs: currentExpiryMs,
    totalDurationMs,
    remainingMs,
    remainingRatio,
    totalPaid,
    paymentCount: count
  };
}


async function createPaymentRecord(connection, {
  userId, plan, cycle, amount, snapshot
}) {
  // content là NOT NULL nên cần giá trị tạm trước khi có paymentId.
  const [result] = await connection.execute(
    `INSERT INTO payments
      (user_id, plan, amount, method, status, approved_by_admin,
       cycle, content, plan_snapshot)
     VALUES (?, ?, ?, 'bank', 'pending_review', 0, ?, ?, ?)`,
    [
      userId,
      plan,
      amount,
      cycle,
      `PENDING_${userId}_${Date.now()}`,
      JSON.stringify(snapshot)
    ]
  );

  const paymentId = result.insertId;
  const content = buildPaymentNote(userId, paymentId);

  await connection.execute(
    `UPDATE payments SET content = ? WHERE id = ?`,
    [content, paymentId]
  );

  return { paymentId, content };
}

// =====================================================
// CREATE PAYMENT
// =====================================================
router.post("/create-payment", auth, async (req, res) => {
  let connection;

  try {
    const userId = Number(req.user?.id);
    const planKey = String(req.body?.plan || "").trim().toLowerCase();
    const cycle = String(req.body?.cycle || "month").trim().toLowerCase();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Invalid user" });
    }

    const planData = getPlan(planKey);

    if (!planData || !["pro", "vip"].includes(planKey)) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    if (!["month", "year"].includes(cycle) ||
        !Array.isArray(planData.cycles) ||
        !planData.cycles.includes(cycle)) {
      return res.status(400).json({ error: "Invalid payment cycle" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [users] = await connection.execute(
      `SELECT id, plan, cycle, expire_at,
        UNIX_TIMESTAMP(expire_at) * 1000 AS expire_ms,
        UNIX_TIMESTAMP(NOW(3)) * 1000 AS now_ms,
        (expire_at > NOW()) AS is_active
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (!users.length) throw new Error("USER_NOT_FOUND");

    const user = users[0];
    const currentPlan = String(user.plan || "free").toLowerCase();
    const isActive = Boolean(user.is_active);
    let paymentType = "purchase";
    let amount = getPlanPrice(planKey, cycle);
    let snapshot = {
      type: "purchase",
      plan: planKey,
      cycle,
      amount
    };

    if (isActive && currentPlan === "vip" && planKey === "pro") {
      throw new Error("VIP_TO_PRO_NOT_ALLOWED");
    }

    if (isActive && currentPlan === "pro" && planKey === "pro") {
      paymentType = "renewal";
      snapshot.type = "renewal";
    } else if (isActive && currentPlan === "vip" && planKey === "vip") {
      paymentType = "renewal";
      snapshot.type = "renewal";
    } else if (isActive && currentPlan === "pro" && planKey === "vip") {
      const currentCycle = String(user.cycle || "month").toLowerCase();

      if (cycle !== currentCycle) {
        throw new Error("UPGRADE_CYCLE_MISMATCH");
      }

      const basis = await getProSubscriptionBasis(connection, user);
      const vipValue = getPlanPrice("vip", cycle) * basis.remainingRatio;
      const proCredit = basis.totalPaid * basis.remainingRatio;

      amount = Math.max(0, Math.round(vipValue - proCredit));

      if (amount <= 0) {
        throw new Error("UPGRADE_AMOUNT_NOT_PAYABLE");
      }

      paymentType = "upgrade";
      snapshot = {
        type: "upgrade",
        fromPlan: "pro",
        toPlan: "vip",
        cycle,
        amount,
        originalProPaid: basis.totalPaid,
        originalProDurationMs: basis.totalDurationMs,
        remainingDurationMs: basis.remainingMs,
        remainingRatio: basis.remainingRatio,
        originalPlanStartMs: basis.planStartMs,
        originalExpireMs: basis.expireMs,
        calculatedVipValue: Math.round(vipValue),
        calculatedProCredit: Math.round(proCredit),
        paymentCount: basis.paymentCount
      };
    } else if (isActive && currentPlan !== "free") {
      throw new Error("UNSUPPORTED_PLAN_CHANGE");
    }


// Chỉ tái sử dụng đơn còn hiệu lực và có báo giá phù hợp.
const [pendingRows] = await connection.execute(
  `SELECT id, amount, content, plan, cycle, plan_snapshot
   FROM payments
   WHERE user_id = ?
     AND plan = ?
     AND cycle = ?
     AND status IN ('pending', 'pending_review')
     AND created_at >= NOW() - INTERVAL 15 MINUTE
   ORDER BY id DESC
   FOR UPDATE`,
  [userId, planKey, cycle]
);

const matchingRows = pendingRows.filter(row => {
  const oldSnapshot = parseSnapshot(row.plan_snapshot);
  const oldType = oldSnapshot.type || "purchase";

  if (oldType !== paymentType) return false;
  if (Number(row.amount) !== Number(amount)) return false;

  if (paymentType === "upgrade") {
    return (
      Number(oldSnapshot.originalExpireMs) ===
      Number(snapshot.originalExpireMs)
    );
  }

  return true;
});

const existing = matchingRows[0] || null;

// Hủy các đơn cùng loại đã có báo giá cũ.
const staleRows = pendingRows.filter(row => {
  const oldSnapshot = parseSnapshot(row.plan_snapshot);
  const oldType = oldSnapshot.type || "purchase";

  return oldType === paymentType &&
    (!existing || Number(row.id) !== Number(existing.id));
});

for (const row of staleRows) {
  await connection.execute(
    `UPDATE payments
     SET status = 'cancelled'
     WHERE id = ?
       AND status IN ('pending', 'pending_review')`,
    [row.id]
  );
}

const bank = getBankInfo();
let paymentId;
let content;
let paymentAmount = amount;

if (existing) {
  paymentId = existing.id;
  content = existing.content;
  paymentAmount = Number(existing.amount);
} else {
  const created = await createPaymentRecord(connection, {
    userId,
    plan: planKey,
    cycle,
    amount,
    snapshot
  });

  paymentId = created.paymentId;
  content = created.content;
}


    await connection.commit();

    const qrUrl =
      `https://img.vietqr.io/image/${process.env.BANK_ID}-${bank.account}-print.png` +
      `?amount=${paymentAmount}&addInfo=${encodeURIComponent(content)}`;

    return res.json({
      paymentId,
      amount: paymentAmount,
      content,
      qrUrl,
      bank,
      plan: planKey,
      cycle,
      paymentType
    });

  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("PAYMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    const messages = {
      USER_NOT_FOUND: [404, "User not found"],
      VIP_TO_PRO_NOT_ALLOWED: [400, "VIP plan cannot be downgraded to PRO"],
      UPGRADE_CYCLE_MISMATCH: [400, "Upgrade must use the current subscription cycle"],
      PRO_SUBSCRIPTION_EXPIRED: [400, "PRO subscription has expired"],
      PRO_PAYMENT_HISTORY_NOT_FOUND: [400, "Cannot calculate upgrade without PRO payment history"],
      INVALID_PRO_PAYMENT_HISTORY: [400, "Invalid PRO payment history"],
      UPGRADE_AMOUNT_NOT_PAYABLE: [400, "Upgrade amount is not payable"],
      UNSUPPORTED_PLAN_CHANGE: [400, "Unsupported plan change"],
      AMBIGUOUS_PRO_PAYMENT_HISTORY: [400,"PRO payment history is ambiguous. Please contact support."],
    };

    const [status, message] = messages[err.message] || [500, err.message || "Payment creation failed"];

    console.error("CREATE PAYMENT ERROR:", err);
    return res.status(status).json({ error: message, code: err.message });

  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;