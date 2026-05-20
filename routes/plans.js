const express = require("express");
const router = express.Router();

// =====================================================
// PLAN DATA (SOURCE OF TRUTH)
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
    durationDays: 7,
    cycles: ["month"]
  },

  pro: {
    id: "pro",
    name: "🔥 PRO PLAN",
    shortName: "PRO",
    price: 19000,
    currency: "VND",
    displayPrice: "19.000đ / month",
    level: 2,
    durationDays: 30,
    cycles: ["month", "year"],
    yearlyDiscount: 0.17
  },

  vip: {
    id: "vip",
    name: "🚀 VIP PLAN",
    shortName: "VIP",
    price: 35000,
    currency: "VND",
    displayPrice: "35.000đ / month",
    level: 3,
    durationDays: 30,
    cycles: ["month", "year"],
    yearlyDiscount: 0.16
  }
};

// =====================================================
// GET PLAN
// =====================================================
function getPlan(planKey) {
  if (!planKey) return null;
  const key = String(planKey).toLowerCase().trim();
  return PLANS[key] || null;
}

// =====================================================
// GET ALL PLANS
// =====================================================
function getPlans() {
  return PLANS;
}

// =====================================================
// CORE LOGIC: CALCULATE EXPIRATION DAYS
// 👉 ONLY 1 PLACE TO CONTROL TIME RULE
// =====================================================
function calculateDurationDays(plan, cycle = "month") {
  if (!plan) return 0;

  const baseDays = plan.durationDays;

  if (cycle === "year") {
    return baseDays * 12;
  }

  return baseDays;
}

// =====================================================
// CALCULATE END DATE
// =====================================================
function getPlanEndDate(user, cycle = "month") {
  if (!user?.plan || !user?.planStartDate) return null;

  const plan = getPlan(user.plan);
  if (!plan) return null;

  const days = calculateDurationDays(plan, cycle);

  const start = new Date(user.planStartDate);

  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

// =====================================================
// CHECK ACTIVE PLAN
// =====================================================
function isPlanActive(user) {
  const end = getPlanEndDate(user);
  return end ? new Date() <= end : false;
}

// =====================================================
// DAYS LEFT
// =====================================================
function getDaysLeft(user) {
  const end = getPlanEndDate(user);
  if (!end) return 0;

  const diff = end - new Date();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

// =====================================================
// PURCHASE FLAGS
// =====================================================
function getPurchaseFlags(user) {
  const plan = user?.plan || "free";

  return {
    canPurchasePro: plan === "free",
    canPurchaseVip: plan !== "vip"
  };
}

// =====================================================
// GET PRICE
// =====================================================
function getPlanPrice(planKey, cycle = "month") {
  const plan = getPlan(planKey);
  if (!plan) return null;

  const base = plan.price;

  if (cycle === "year" && plan.yearlyDiscount) {
    return Math.round(base * 12 * (1 - plan.yearlyDiscount));
  }

  return base;
}

// =====================================================
// API: ALL PLANS
// =====================================================
router.get("/plans", (req, res) => {
  const result = Object.values(PLANS).map(p => ({
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    price: p.price,
    currency: p.currency,
    displayPrice: p.displayPrice,
    level: p.level,
    durationDays: p.durationDays,
    cycles: p.cycles,
    yearlyDiscount: p.yearlyDiscount || 0
  }));

  res.json(
    result.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {})
  );
});

// =====================================================
// API: PLAN STATUS
// =====================================================
router.get("/plan-status", (req, res) => {
  const user = {
    plan: req.query.plan || "free",
    planStartDate: req.query.startDate || new Date().toISOString(),
    cycle: req.query.cycle || "month"
  };

  const plan = getPlan(user.plan);
  const endDate = getPlanEndDate(user, user.cycle);

  const daysLeft = endDate
    ? Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  res.json({
    plan,
    planStartDate: user.planStartDate,
    planEndDate: endDate,
    daysLeft,
    price: getPlanPrice(user.plan, user.cycle),
    cycle: user.cycle,
    ...getPurchaseFlags(user)
  });
});

// =====================================================
// EXPORTS (CLEAN - NO DUPLICATE EXPORT)
// =====================================================
module.exports = router;

module.exports.PLANS = PLANS;
module.exports.getPlan = getPlan;
module.exports.getPlans = getPlans;
module.exports.getPlanEndDate = getPlanEndDate;
module.exports.getDaysLeft = getDaysLeft;
module.exports.getPurchaseFlags = getPurchaseFlags;
module.exports.getPlanPrice = getPlanPrice;
module.exports.calculateDurationDays = calculateDurationDays;