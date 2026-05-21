const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const { getPlan } = require("./plans");

router.post("/upgrade", auth, async (req, res) => {
  try {
    const plan = String(req.body.plan || "").toLowerCase();
    const cycle = String(req.body.cycle || "month").toLowerCase();

    const planData = getPlan(plan);

    if (!planData || !["pro", "vip"].includes(plan)) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const validCycle = planData.cycles.includes(cycle)
      ? cycle
      : "month";

    // 🔥 CHỐT 1: LUÔN LUÔN LẤY DURATION AN TOÀN
    const durationDays =
      planData.duration[validCycle] ??
      planData.duration.month;

    // 🔥 CHỐT 2: KHÔNG DÙNG setDate (tránh lỗi tháng 30/31)
    const now = Date.now();
    const expireAt = new Date(now + durationDays * 86400000);

    // 🔥 UPDATE USERS (SOURCE OF TRUTH)
    await db.query(
      `UPDATE users 
       SET plan=?, plan_cycle=?, plan_start_date=?, expire_at=? 
       WHERE id=?`,
      [
        plan,
        validCycle,
        new Date(now).toISOString(),
        expireAt.toISOString(),
        req.user.id
      ]
    );

    // 🔥 LOG PAYMENT (KHÔNG ĐƯỢC TÍNH LẠI NGÀY Ở ĐÂY)
    await db.query(
      `INSERT INTO payments 
      (user_id, plan, amount, cycle, status, expire_at, plan_start_date)
      VALUES (?, ?, ?, ?, 'paid', ?, ?)`,
      [
        req.user.id,
        plan,
        planData.price,
        validCycle,
        expireAt.toISOString(),
        new Date(now).toISOString()
      ]
    );

    res.json({
      success: true,
      plan,
      cycle: validCycle,
      expire_at: expireAt.toISOString()
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;