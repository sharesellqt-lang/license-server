const express = require("express");
const router = express.Router();

// =====================================================
// PLAN DATA
// =====================================================

const PLANS = {
  free: {
    id: "free",
    name: "Free Trial",
    shortName: "FREE",
    price: 0,
    currency: "VND",
    displayPrice: "0đ",
    level: 1,
    durationDays: 7  // dùng thử 7 ngày
  },
  pro: {
    id: "pro",
    name: "🔥 PRO PLAN",
    shortName: "PRO",
    price: 19000,
    currency: "VND",
    displayPrice: "19.000đ / month",
    level: 2,
    durationDays: 30
  },
  vip: {
    id: "vip",
    name: "🚀 VIP PLAN",
    shortName: "VIP",
    price: 35000,
    currency: "VND",
    displayPrice: "35.000đ / month",
    level: 3,
    durationDays: 30
  }
};

// Helpers
function getPlans() { return PLANS; }

function getPlan(planKey) {
  if (!planKey) return null;
  const key = String(planKey).trim().toLowerCase();
  return PLANS[key] || null;
}

// API
router.get("/plans", (req, res) => {
  res.json(getPlans());
});

module.exports = router;
module.exports.PLANS = PLANS;
module.exports.getPlans = getPlans;
module.exports.getPlan = getPlan;