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

const norm = v => String(v || "").toLowerCase();

function getPlan(plan) {
  return PLANS[norm(plan)] || null;
}

router.get("/plans", (req, res) => {
  res.json(PLANS);
});

// CHỈ DEBUG - KHÔNG TÍNH LOGIC Ở ĐÂY
router.get("/plan-status", (req, res) => {
  const { expire_at } = req.query;

  const end = new Date(expire_at);
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));

  res.json({ expire_at, daysLeft });
});

module.exports = router;
module.exports.PLANS = PLANS;
module.exports.getPlan = getPlan;