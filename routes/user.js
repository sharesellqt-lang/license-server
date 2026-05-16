const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

const { getPlan } = require("../routes/plans"); // import helper planData

router.get("/me", auth, async (req, res) => {
  const plan = req.user.plan || "free";
  const planData = getPlan(plan);

  // Tính ngày bắt đầu dựa vào expire_at nếu có
  let planStartDate = req.user.created_at; // mặc định fallback
  if (req.user.expire_at && planData) {
    const expire = new Date(req.user.expire_at);
    planStartDate = new Date(expire);
    planStartDate.setDate(expire.getDate() - planData.durationDays);
  }

  return res.json({
    id: req.user.id,
    plan: plan,
    licensed: plan !== "free",
    planStartDate: planStartDate.toISOString(), // trả ISO để JS frontend parse chuẩn
    expireAt: req.user.expire_at
  });
});

module.exports = router;