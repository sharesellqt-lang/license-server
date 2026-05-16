const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { getPlan } = require("../routes/plans");

router.get("/me", auth, async (req, res) => {
  try {
    const plan = req.user.plan || "free";
    const planData = getPlan(plan);

    let planStartDate;
    if (req.user.expire_at && planData) {
      const expire = new Date(req.user.expire_at);
      planStartDate = new Date(expire);
      planStartDate.setDate(expire.getDate() - planData.durationDays);
    } else {
      planStartDate = new Date(req.user.created_at);
    }

    return res.json({
      id: req.user.id,
      plan: plan,
      licensed: plan !== "free",
      planStartDate: planStartDate.toISOString(),
      expireAt: req.user.expire_at ? new Date(req.user.expire_at).toISOString() : null
    });
  } catch (err) {
    console.error("Error in /me:", err);
    return res.status(500).json({ error: "Failed to fetch user info" });
  }
});

module.exports = router;