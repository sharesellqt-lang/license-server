const express = require("express");
const router = express.Router();

// =====================================================
// PLAN DATA (CHUẨN SUBSCRIPTION)
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

function normalizePlanKey(key) {
  if (!key) return null;
  return String(key).trim().toLowerCase();
}

function getPlans() {
  return PLANS;
}

function getPlan(planKey) {
  const key = normalizePlanKey(planKey);
  return PLANS[key] || null;
}

// =====================================================
// TÍNH EXPIRATION CHUẨN (THEO CYCLE)
// =====================================================

function getPlanEndDate(user, cycle = "month") {
  if (!user?.plan || !user?.planStartDate) return null;

  const plan = getPlan(user.plan);
  if (!plan) return null;

  const durationDays = plan.duration?.[cycle] || plan.duration?.month || 30;

  const start = new Date(user.planStartDate);
  const end = new Date(start);
  end.setDate(start.getDate() + durationDays);

  return end;
}

// =====================================================
// DAYS LEFT
// =====================================================

function getDaysLeft(user, cycle = "month") {
  const end = getPlanEndDate(user, cycle);
  if (!end) return 0;

  const now = new Date();
  const diff = end - now;

  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

// =====================================================
// PURCHASE FLAGS
// =====================================================

function getPurchaseFlags(user) {
  const plan = normalizePlanKey(user?.plan) || "free";

  return {
    canPurchasePro: plan === "free",
    canPurchaseVip: plan !== "vip"
  };
}

// =====================================================
// PRICE CALC
// =====================================================

function getPlanPrice(planKey, cycle = "month") {
  const plan = getPlan(planKey);
  if (!plan) return null;

  let price = plan.price;

  if (cycle === "year" && plan.yearlyDiscount) {
    price = Math.round(price * 12 * (1 - plan.yearlyDiscount));
  }

  return price;
}

// =====================================================
// API: GET ALL PLANS
// =====================================================

router.get("/plans", (req, res) => {
  const allPlans = Object.values(PLANS).map(plan => ({
    id: plan.id,
    name: plan.name,
    shortName: plan.shortName,
    price: plan.price,
    currency: plan.currency,
    displayPrice: plan.displayPrice,
    level: plan.level,
    cycles: plan.cycles,
    duration: plan.duration,
    yearlyDiscount: plan.yearlyDiscount || 0
  }));

  res.json(
    allPlans.reduce((obj, plan) => {
      obj[plan.id] = plan;
      return obj;
    }, {})
  );
});

// =====================================================
// API: PLAN STATUS (REAL USER STATUS)
// =====================================================

router.get("/plan-status", (req, res) => {
  const user = {
    plan: req.query.plan || "free",
    planStartDate: req.query.startDate || new Date().toISOString(),
    cycle: req.query.cycle || "month"
  };

  const planData = getPlan(user.plan);
  const endDate = getPlanEndDate(user, user.cycle);
  const daysLeft = getDaysLeft(user, user.cycle);
  const price = getPlanPrice(user.plan, user.cycle);

  res.json({
    plan: planData,
    planStartDate: user.planStartDate,
    planEndDate: endDate,
    daysLeft,
    cycle: user.cycle,
    price,
    ...getPurchaseFlags(user)
  });
});

// =====================================================
// EXPORTS
// =====================================================

module.exports = router;

module.exports.PLANS = PLANS;
module.exports.getPlans = getPlans;
module.exports.getPlan = getPlan;
module.exports.getPlanEndDate = getPlanEndDate;
module.exports.getDaysLeft = getDaysLeft;
module.exports.getPurchaseFlags = getPurchaseFlags;
module.exports.getPlanPrice = getPlanPrice;