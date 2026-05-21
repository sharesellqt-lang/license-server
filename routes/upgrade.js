const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");
const { getPlan } = require("./plans"); // import helper planData

router.post("/upgrade", authMiddleware, async (req, res) => {
  const { plan } = req.body;

  if (!["pro", "vip"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {
    // Lấy durationDays từ plan
    const planData = getPlan(plan);
    if (!planData) return res.status(400).json({ error: "Plan not found" });

    // Tính expire_at = NOW + durationDays
    const now = new Date();
    const expireAt = new Date(now);
    expireAt.setDate(now.getDate() + planData.durationDays);

    // Cập nhật user: plan + expire_at
    await db.query(
      "UPDATE users SET plan = ?, expire_at = ? WHERE id = ?",
      [plan, expireAt, req.user.id]
    );

    res.json({ success: true, plan, expireAt });
  } catch (err) {
    console.log("UPGRADE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;