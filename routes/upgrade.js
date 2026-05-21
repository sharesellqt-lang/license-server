const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const { getPlan } = require("./plans");

// =====================================================
// UPGRADE PLAN (NO BUG VERSION)
// =====================================================

router.post("/upgrade", auth, async (req, res) => {
  try {
    const plan = String(req.body.plan || "").toLowerCase();
    const cycle = String(req.body.cycle || "month").toLowerCase();

    const planData = getPlan(plan);

    if (!planData || !["pro", "vip"].includes(plan)) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    // validate cycle
    const validCycle = planData.cycles.includes(cycle)
      ? cycle
      : "month";

    // =====================================================
    // FIX: ALWAYS SAFE DURATION
    // =====================================================

    const durationDays =
      planData.duration?.[validCycle] ??
      planData.duration?.month ??
      30;

    const now = Date.now();

    // ✔ ABSOLUTE FIX (NO setDate BUG)
    const expireAt = new Date(now + durationDays * 86400000);

    // =====================================================
    // SAVE DB
    // =====================================================

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

    res.json({
      success: true,
      plan,
      cycle: validCycle,
      expire_at: expireAt.toISOString(),
      days: durationDays
    });

  } catch (err) {
    console.log("UPGRADE ERROR:", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;