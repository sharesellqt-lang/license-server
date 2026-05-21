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

const norm = (v) => String(v || "").toLowerCase();

function getPlan(plan) {
  return PLANS[norm(plan)] || null;
}

// GET plans (frontend dùng render UI)
router.get("/plans", (req, res) => {
  res.json(PLANS);
});

// PLAN STATUS (debug / admin)
router.get("/plan-status", (req, res) => {
  const expire_at = req.query.expire_at;

  if (!expire_at) {
    return res.json({ daysLeft: 0 });
  }

  const end = new Date(expire_at);
  const daysLeft = Math.ceil((end - new Date()) / 86400000);

  res.json({
    expire_at,
    daysLeft: daysLeft > 0 ? daysLeft : 0
  });
});

module.exports = router;
module.exports.PLANS = PLANS;
module.exports.getPlan = getPlan;