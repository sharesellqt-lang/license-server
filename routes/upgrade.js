const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");
const { getPlan } = require("./plans");

// =====================================================
// UPGRADE PLAN (MONTH / YEAR SUPPORT)
// =====================================================

router.post("/upgrade", authMiddleware, async (req, res) => {
  const { plan, cycle = "month" } = req.body;

  try {
    // =====================================================
    // 1. VALIDATE PLAN
    // =====================================================
    const planData = getPlan(plan?.toLowerCase());

    if (!planData) {
      return res.status(400).json({ error: "Plan not found" });
    }

    if (!["pro", "vip"].includes(planData.id)) {
      return res.status(400).json({ error: "Invalid upgrade plan" });
    }

    // =====================================================
    // 2. VALIDATE CYCLE
    // =====================================================
    const validCycle = planData.cycles.includes(cycle)
      ? cycle
      : planData.cycles[0];

    // =====================================================
    // 3. CALCULATE START + EXPIRE (SOURCE OF TRUTH)
    // =====================================================
    const now = new Date();

    const durationDays =
      planData.duration?.[validCycle] || 30;

    const expireAt = new Date(now);
    expireAt.setDate(now.getDate() + durationDays);

    // =====================================================
    // 4. UPDATE USER
    // =====================================================
    await db.query(
      `
      UPDATE users 
      SET 
        plan = ?, 
        planStartDate = ?, 
        expire_at = ?, 
        plan_cycle = ?
      WHERE id = ?
      `,
      [
        planData.id,
        now.toISOString(),
        expireAt.toISOString(),
        validCycle,
        req.user.id
      ]
    );

    // =====================================================
    // 5. RESPONSE
    // =====================================================
    res.json({
      success: true,
      plan: planData.id,
      cycle: validCycle,
      planStartDate: now,
      expireAt,
      durationDays
    });

  } catch (err) {
    console.log("UPGRADE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;