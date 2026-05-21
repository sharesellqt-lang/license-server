const express = require("express");
const router = express.Router();

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
    }
  },

  vip: {
    id: "vip",
    price: 35000,
    cycles: ["month", "year"],
    duration: {
      month: 30,
      year: 365
    }
  }
};

// 🔒 SAFE GET PLAN (KHÔNG BAO GIỜ undefined)
function getPlan(plan) {
  return PLANS[String(plan || "free").toLowerCase()] || PLANS.free;
}

// 🔒 SAFE CYCLE
function normalizeCycle(planData, cycle) {
  const c = String(cycle || "month").toLowerCase();
  return planData.cycles.includes(c) ? c : "month";
}

router.get("/plans", (req, res) => {
  res.json(PLANS);
});

module.exports = router;
module.exports.PLANS = PLANS;
module.exports.getPlan = getPlan;
module.exports.normalizeCycle = normalizeCycle;