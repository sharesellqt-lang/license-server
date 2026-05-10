const express = require("express");

const router = express.Router();

// =====================================================
// PLAN DATA
// =====================================================

const PLANS = {

  pro: {
    id: "pro",

    name: "🔥 PRO PLAN",
    shortName: "PRO",

    price: 15000,
    currency: "VND",

    displayPrice: "15.000đ",
    displayMonthly: "15.000đ / month",

    note: "PRO_SUBSCRIPTION",

    level: 2
  },

  vip: {
    id: "vip",

    name: "🚀 VIP PLAN",
    shortName: "VIP",

    price: 30000,
    currency: "VND",

    displayPrice: "30.000đ",
    displayMonthly: "30.000đ / month",

    note: "VIP_SUBSCRIPTION",

    level: 3
  }

};

// =====================================================
// HELPERS
// =====================================================

function getPlans() {

  return PLANS;
}

function getPlan(planKey) {

  if (!planKey) {
    return null;
  }

  const key =
    String(planKey)
      .trim()
      .toLowerCase();

  return PLANS[key] || null;
}

// =====================================================
// API
// =====================================================

router.get("/plans", (req, res) => {

  try {

    return res.json(
      getPlans()
    );

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Failed to load plans"
    });
  }
});

// =====================================================
// EXPORTS
// =====================================================

module.exports = router;

module.exports.PLANS = PLANS;
module.exports.getPlans = getPlans;
module.exports.getPlan = getPlan;