const express = require("express");
const router = express.Router();

// =====================================================
// PLANS CONFIG (SINGLE SOURCE OF TRUTH)
// =====================================================

const PLANS = {
  free: {
    id: "free",
    cycles: ["trial"],
    duration: { trial: 7 }
  },

  pro: {
    id: "pro",
    price: 19000,
    cycles: ["month", "year"],
    duration: {
      month: 30,
      year: 365
    },
    yearlyDiscount: 0.17
  },

  vip: {
    id: "vip",
    price: 35000,
    cycles: ["month", "year"],
    duration: {
      month: 30,
      year: 365
    },
    yearlyDiscount: 0.16
  }
};

// normalize
const norm = (v) => String(v || "").toLowerCase();

function getPlan(plan) {
  return PLANS[norm(plan)] || null;
}

// =====================================================
// GET PLANS
// =====================================================

router.get("/plans", (req, res) => {
  res.json(PLANS);
});

// =====================================================
// PLAN STATUS (ONLY expire_at)
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