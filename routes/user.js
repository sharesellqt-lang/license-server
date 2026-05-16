const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  // Chuyển expire_at thành planStartDate và planEndDate
  const now = new Date();
  let planStartDate;
  if (req.user.expire_at) {
    // Giả sử plan durationDays = 30 nếu không có
    const durationDays = 30; 
    const expireAt = new Date(req.user.expire_at);
    planStartDate = new Date(expireAt.getTime() - durationDays * 24 * 60 * 60 * 1000);
  } else {
    planStartDate = now;
  }

  return res.json({
    id: req.user.id,
    plan: req.user.plan,
    licensed: req.user.plan !== "free",
    planStartDate: planStartDate.toISOString(), // frontend cần trường này
    expireAt: req.user.expire_at ? new Date(req.user.expire_at).toISOString() : null
  });
});

module.exports = router;