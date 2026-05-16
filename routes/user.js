const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

const { getPlan } = require("../routes/plans"); // import helper planData

router.get("/me", auth, async (req, res) => {
  const plan = req.user.plan || "free";
  const planData = getPlan(plan);

  let planStartDate = new Date();
  if (req.user.expire_at && planData) {
    const expire = new Date(req.user.expire_at);
    planStartDate = new Date(expire);
    planStartDate.setDate(expire.getDate() - planData.durationDays);
  }

  return res.json({
    id: req.user.id,
    plan: plan,
    licensed: plan !== "free",
    planStartDate: planStartDate.toISOString(), // trả đúng startDate
    expireAt: req.user.expire_at
  });
});

module.exports = router;