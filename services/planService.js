
"use strict";

const PLAN_RANK = {
  free: 0,
  pro: 1,
  vip: 2
};

// =====================================================
// DATE HELPERS
// =====================================================
function getExpireDate(days) {
  const expire = new Date();
  expire.setDate(expire.getDate() + Number(days || 0));
  return expire;
}

function parseDbDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const str = String(value).trim();
  const normalized = str.includes("T")
    ? str
    : str.replace(" ", "T");

  return new Date(
    /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}+07:00`
  );
}

function formatDbDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result;
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + Number(months));

  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();

  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function getDatabaseNow(connection) {
  const [[row]] = await connection.query(
    `SELECT NOW() AS db_now`
  );

  const now = parseDbDate(row?.db_now);

  if (!now || Number.isNaN(now.getTime())) {
    throw new Error("INVALID_DATABASE_TIME");
  }

  return now;
}

// =====================================================
// APPLY PLAN
// Dùng cho mua mới và gia hạn thông thường.
// Phải chạy bên trong transaction.
// =====================================================
async function applyPlan(connection, {
  userId,
  plan,
  durationDays = 0,
  durationMonths = 0,
  allowDowngrade = false,
  cycle = "month"
}) {
  const targetPlan = String(plan || "").trim().toLowerCase();
  const uid = Number(userId);
  const days = Number(durationDays);
  const months = Number(durationMonths);
  const normalizedCycle = cycle === "year" ? "year" : "month";

  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  if (!["free", "pro", "vip"].includes(targetPlan)) {
    throw new Error("INVALID_PLAN");
  }

  if (targetPlan === "free") {
    const [result] = await connection.execute(
      `UPDATE users
       SET plan = 'free',
           expire_at = NULL,
           cycle = 'month'
       WHERE id = ?`,
      [uid]
    );

    if (!result.affectedRows) {
      throw new Error("USER_NOT_FOUND");
    }

    return {
      userId: uid,
      planBefore: null,
      planAfter: "free",
      expireAt: null
    };
  }

  if (
    !Number.isInteger(days) ||
    days < 0 ||
    !Number.isInteger(months) ||
    months < 0 ||
    (days === 0 && months === 0)
  ) {
    throw new Error("INVALID_DURATION");
  }

  const now = await getDatabaseNow(connection);

  const [users] = await connection.execute(
    `SELECT id, plan, expire_at, cycle
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [uid]
  );

  if (!users.length) {
    throw new Error("USER_NOT_FOUND");
  }

  const user = users[0];
  const currentPlan = String(user.plan || "free").toLowerCase();
  const currentExpiry = parseDbDate(user.expire_at);

  const isActive =
    currentPlan !== "free" &&
    currentExpiry &&
    currentExpiry.getTime() > now.getTime();

  if (
    isActive &&
    currentPlan === "pro" &&
    targetPlan === "vip"
  ) {
    throw new Error("UPGRADE_REQUIRES_PRORATED_PAYMENT");
  }

  if (
    isActive &&
    (PLAN_RANK[targetPlan] < (PLAN_RANK[currentPlan] ?? 0)) &&
    !allowDowngrade
  ) {
    throw new Error("PLAN_DOWNGRADE_NOT_ALLOWED");
  }

  const startBase = isActive ? currentExpiry : now;

  let expireAt = addDays(startBase, days);
  expireAt = addMonths(expireAt, months);

  const startSql = formatDbDate(startBase);
  const expireAtSql = formatDbDate(expireAt);

  await connection.execute(
    `UPDATE users
     SET plan = ?,
         expire_at = ?,
         cycle = ?
     WHERE id = ?`,
    [targetPlan, expireAtSql, normalizedCycle, uid]
  );

  return {
    userId: uid,
    planBefore: currentPlan,
    planAfter: targetPlan,
    wasActive: Boolean(isActive),
    previousExpireAt: user.expire_at || null,
    planStartDate: startSql,
    expireAt: expireAtSql,
    cycle: normalizedCycle
  };
}

// =====================================================
// UPGRADE PRO -> VIP
// Khấu trừ PRO credit và bắt đầu chu kỳ VIP mới.
// Phải chạy bên trong transaction.
// =====================================================
async function upgradePlan(connection, {
  userId,
  cycle,
  expectedExpireMs
}) {
  const uid = Number(userId);
  const normalizedCycle = String(cycle || "").toLowerCase();

  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  if (!["month", "year"].includes(normalizedCycle)) {
    throw new Error("INVALID_PAYMENT_CYCLE");
  }

  const expectedExpiry = Number(expectedExpireMs);

  if (!Number.isFinite(expectedExpiry) || expectedExpiry <= 0) {
    throw new Error("INVALID_UPGRADE_SNAPSHOT");
  }

  const now = await getDatabaseNow(connection);

  const [rows] = await connection.execute(
    `SELECT id, plan, cycle, expire_at
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [uid]
  );

  if (!rows.length) {
    throw new Error("USER_NOT_FOUND");
  }

  const user = rows[0];
  const currentPlan = String(user.plan || "free").toLowerCase();
  const currentCycle = String(user.cycle || "month").toLowerCase();
  const currentExpiry = parseDbDate(user.expire_at);

  if (currentPlan !== "pro") {
    throw new Error("UPGRADE_SOURCE_PLAN_INVALID");
  }

  if (
    !currentExpiry ||
    currentExpiry.getTime() <= now.getTime()
  ) {
    throw new Error("PLAN_EXPIRED");
  }

  if (currentCycle !== normalizedCycle) {
    throw new Error("UPGRADE_CYCLE_MISMATCH");
  }

  if (
    Math.abs(currentExpiry.getTime() - expectedExpiry) > 2000
  ) {
    throw new Error("UPGRADE_QUOTE_EXPIRED");
  }

  // Chu kỳ VIP mới bắt đầu từ thời điểm nâng cấp.
  // Tháng = 31 ngày; năm = 12 tháng.
  const planStart = now;
  const expireAt = normalizedCycle === "month"
    ? addDays(planStart, 30)
    : addMonths(planStart, 12);

  const startSql = formatDbDate(planStart);
  const expireAtSql = formatDbDate(expireAt);

  await connection.execute(
    `UPDATE users
     SET plan = 'vip',
         expire_at = ?,
         cycle = ?
     WHERE id = ?`,
    [expireAtSql, normalizedCycle, uid]
  );

  return {
    userId: uid,
    planBefore: "pro",
    planAfter: "vip",
    wasActive: true,
    previousExpireAt: user.expire_at,
    planStartDate: startSql,
    expireAt: expireAtSql,
    cycle: normalizedCycle
  };
}

// =====================================================
// EXPORTS
// =====================================================
module.exports = {
  getExpireDate,
  applyPlan,
  upgradePlan,
  PLAN_RANK
};
