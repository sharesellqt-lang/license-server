const express = require("express");
const router = express.Router();

// =====================================================
// PLANS (SOURCE OF TRUTH)
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
    cycles: ["trial"],
    duration: {
      trial: 7
    }
  },

  pro: {
    id: "pro",
    name: "🔥 PRO PLAN",
    shortName: "PRO",
    price: 19000,
    currency: "VND",
    displayPrice: "19.000đ",
    level: 2,
    cycles: ["month", "year"],
    duration: {
      month: 30,
      year: 365
    },
    yearlyDiscount: 0.17
  },

  vip: {
    id: "vip",
    name: "🚀 VIP PLAN",
    shortName: "VIP",
    price: 35000,
    currency: "VND",
    displayPrice: "35.000đ",
    level: 3,
    cycles: ["month", "year"],
    duration: {
      month: 30,
      year: 365
    },
    yearlyDiscount: 0.16
  }
};

// =====================================================
// HELPERS
// =====================================================

const norm = (v) => String(v || "").toLowerCase();

function getPlan(planKey) {
  return PLANS[norm(planKey)] || null;
}

function getPlans() {
  return PLANS;
}

// =====================================================
// API: GET ALL PLANS
// =====================================================

router.get("/plans", (req, res) => {
  res.json(PLANS);
});

// =====================================================
// PLAN STATUS (USE expire_at ONLY)
// =====================================================

router.get("/plan-status", (req, res) => {
  const user = {
    plan: req.query.plan || "free",
    expire_at: req.query.expire_at || new Date().toISOString()
  };

  const end = new Date(user.expire_at);
  const daysLeft = Math.ceil((end - new Date()) / 86400000);

  res.json({
    plan: user.plan,
    expire_at: user.expire_at,
    daysLeft: daysLeft > 0 ? daysLeft : 0
  });
});

module.exports = router;
module.exports.PLANS = PLANS;
module.exports.getPlan = getPlan;
module.exports.getPlans = getPlans;