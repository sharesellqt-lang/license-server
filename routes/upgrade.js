const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");
const { getPlan } = require("./plans");

// =====================================================
// UPGRADE PLAN (CLEAN LOGIC)
// =====================================================

router.post("/upgrade", authMiddleware, async (req, res) => {
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

    // =====================================================
    // SOURCE OF TRUTH: expire_at ONLY
    // =====================================================

    const now = Date.now();
    const durationDays = planData.duration[validCycle];

    const expireAt = new Date(now + durationDays * 86400000);

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
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;