
"use strict";

const PLAN_RANK = {
  free: 0,
  pro: 1,
  vip: 2
};

function getExpireDate(days) {
  const expire = new Date();
  expire.setDate(expire.getDate() + Number(days || 0));
  return expire;
}

function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());

  const str = String(value).trim();
  const normalized = str.includes("T") ? str : str.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}+07:00`);
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

  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));

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

/**
 * Phải được gọi bên trong transaction của caller.
 *
 * PRO đang hoạt động -> VIP: VIP có hiệu lực ngay,
 * thời gian còn lại của PRO được cộng vào thời hạn VIP.
 *
 * VIP đang hoạt động -> PRO: mặc định không cho phép.
 */
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

  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  if (!["free", "pro", "vip"].includes(targetPlan)) {
    throw new Error("INVALID_PLAN");
  }

  if (targetPlan === "free") {
    const [result] = await connection.execute(
      `UPDATE users SET plan = 'free', expire_at = NULL, cycle = 'month' WHERE id = ?`,
      [uid]
    );

    if (!result.affectedRows) throw new Error("USER_NOT_FOUND");

    return {
      userId: uid,
      planBefore: null,
      planAfter: "free",
      expireAt: null
    };
  }

  if ((!Number.isInteger(days) || days < 0) ||
      (!Number.isInteger(months) || months < 0) ||
      (days === 0 && months === 0)) {
    throw new Error("INVALID_DURATION");
  }

  const [[nowRow]] = await connection.query(
    `SELECT NOW() AS current_time`
  );

  const now = parseDbDate(nowRow.current_time);

  const [users] = await connection.execute(
    `SELECT id, plan, expire_at, cycle
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [uid]
  );

  if (!users.length) throw new Error("USER_NOT_FOUND");

  const user = users[0];
  const currentPlan = String(user.plan || "free").toLowerCase();
  const currentExpiry = parseDbDate(user.expire_at);
  const isActive = currentPlan !== "free" &&
    currentExpiry &&
    currentExpiry.getTime() > now.getTime();

  if (isActive &&
      (PLAN_RANK[targetPlan] < (PLAN_RANK[currentPlan] ?? 0)) &&
      !allowDowngrade) {
    throw new Error("PLAN_DOWNGRADE_NOT_ALLOWED");
  }

  // Nếu gói hiện tại còn hạn, nối thời gian mới vào ngày hết hạn.
  // Nếu đã hết hạn hoặc đang FREE, tính từ thời điểm hiện tại.
  const startBase = isActive ? currentExpiry : now;

  let expireAt = addDays(startBase, days);
  expireAt = addMonths(expireAt, months);

  const expireAtSql = formatDbDate(expireAt);

  await connection.execute(
    `UPDATE users
     SET plan = ?, expire_at = ?, cycle = ?
     WHERE id = ?`,
    [targetPlan, expireAtSql, cycle === "year" ? "year" : "month", uid]
  );

  return {
    userId: uid,
    planBefore: currentPlan,
    planAfter: targetPlan,
    wasActive: Boolean(isActive),
    previousExpireAt: user.expire_at || null,
    planStartDate: formatDbDate(now),
    expireAt: expireAtSql,
    cycle: cycle === "year" ? "year" : "month"
  };
}

module.exports = {
  getExpireDate,
  applyPlan,
  PLAN_RANK
};
