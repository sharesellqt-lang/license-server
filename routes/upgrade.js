const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const { getPlan, normalizeCycle } = require("./plans");

router.post("/upgrade", auth, async (req, res) => {
  try {
    // 🔒 FORCE SAFE INPUT
    const plan = String(req.body.plan || "free").toLowerCase();
    const planData = getPlan(plan);

    const cycle = normalizeCycle(planData, req.body.cycle);

    // 🔒 SAFE DURATION (NEVER undefined)
    const durationDays =
      planData.duration?.[cycle] ??
      planData.duration?.month ??
      30;

    const now = Date.now();

    // 🔥 ONLY SOURCE OF TRUTH
    const expireAt = new Date(now + durationDays * 86400000);

    // =====================================================
    // UPDATE USERS (STATE)
    // =====================================================
    await db.query(
      `UPDATE users 
       SET plan=?, plan_cycle=?, plan_start_date=?, expire_at=? 
       WHERE id=?`,
      [
        planData.id,
        cycle,
        new Date(now).toISOString(),
        expireAt.toISOString(),
        req.user.id
      ]
    );

    // =====================================================
    // PAYMENT LOG (HISTORY ONLY)
    // =====================================================
    await db.query(
      `INSERT INTO payments 
      (user_id, plan, amount, cycle, status, expire_at, plan_start_date)
      VALUES (?, ?, ?, ?, 'paid', ?, ?)`,
      [
        req.user.id,
        planData.id,
        planData.price,
        cycle,
        expireAt.toISOString(),
        new Date(now).toISOString()
      ]
    );

    res.json({
      success: true,
      plan: planData.id,
      cycle,
      expire_at: expireAt.toISOString(),
      days: durationDays
    });

  } catch (err) {
    console.log("UPGRADE ERROR:", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;