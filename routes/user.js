const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

// import helper planData
const { getPlan } = require("../routes/plans");

router.get("/me", auth, async (req, res) => {
  try {
    const plan = req.user.plan || "free";
    const planData = getPlan(plan);

    // Tính ngày bắt đầu plan dựa vào expire_at
    let planStartDate;
    try {
      if (req.user.expire_at && planData) {
        const expire = new Date(req.user.expire_at);
        planStartDate = new Date(expire);
        planStartDate.setDate(expire.getDate() - planData.durationDays);
      } else {
        planStartDate = new Date(req.user.created_at);
      }
    } catch {
      planStartDate = new Date(req.user.created_at);
    }

    return res.json({
      id: req.user.id,
      email: req.user.email,
      plan: plan,
      licensed: plan !== "free",
      planStartDate: planStartDate.toISOString(),
      expireAt: req.user.expire_at
    });
  } catch (err) {
    console.error("Error in /me:", err);
    return res.status(500).json({ error: "Failed to fetch user info" });
  }
});

module.exports = router;