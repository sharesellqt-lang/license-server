const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { getPlan } = require("../routes/plans"); // helper plan data
const db = require("../db"); // kết nối database

router.get("/me", auth, async (req, res) => {
  try {
    const user = await db.query(
      "SELECT id, plan, created_at, expire_at FROM users WHERE id = ?",
      [req.user.id]
    ).then(r => r[0][0]);

    if (!user) return res.status(404).json({ error: "User not found" });

    const planKey = user.plan || "free";
    const planData = getPlan(planKey);

    // Tính planStartDate dựa vào expire_at và durationDays
    let planStartDate;
    if (user.expire_at && planData) {
      const expire = new Date(user.expire_at);
      planStartDate = new Date(expire);
      planStartDate.setDate(expire.getDate() - (planData.durationDays || 0));
    } else {
      planStartDate = new Date(user.created_at);
    }

    return res.json({
      id: user.id,
      plan: planKey,
      licensed: planKey !== "free",
      planStartDate,
      expireAt: user.expire_at
    });

  } catch (err) {
    console.error("Error in /me:", err);
    return res.status(500).json({ error: "Failed to fetch user info" });
  }
});

module.exports = router;