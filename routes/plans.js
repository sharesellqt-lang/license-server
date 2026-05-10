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
// GET ALL PLANS
// =====================================================

function getPlans() {

  return PLANS;
}

// =====================================================
// GET PLAN BY KEY
// =====================================================

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

module.exports = {
  PLANS,
  getPlans,
  getPlan
};