const express = require("express");
const router = express.Router();
const { PLANS, getPlan } = require("./plans.data");

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
    durationDays: 7, // dùng thử 7 ngày
    cycles: ["month"] // free chỉ dùng thử
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
    cycles: ["month", "year"], // có tháng và năm
    yearlyDiscount: 0.17 // giảm ~17% nếu mua năm
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
// HELPERS
// =====================================================

// Lấy tất cả plan
function getPlans() {
  return PLANS;
}

// Lấy plan theo key
function getPlan(planKey) {
  if (!planKey) return null;
  const key = String(planKey).trim().toLowerCase();
  return PLANS[key] || null;
}

// Tính ngày kết thúc dựa vào planStartDate & duration
function getPlanEndDate(user) {
  if (!user || !user.plan || !user.planStartDate) return null;
  const plan = getPlan(user.plan);
  if (!plan) return null;

  const start = new Date(user.planStartDate);
  const end = new Date(start);
  end.setDate(start.getDate() + plan.durationDays);
  return end;
}

// Tính số ngày còn lại
function getDaysLeft(user) {
  const end = getPlanEndDate(user);
  if (!end) return null;
  const now = new Date();
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

// Kiểm tra nút mua Pro/VIP
function getPurchaseFlags(user) {
  const plan = user?.plan || "free";
  return {
    canPurchasePro: plan === "free",
    canPurchaseVip: plan !== "vip"
  };
}

// =====================================================
// HỖ TRỢ LOGIC MUA GÓI NĂM THÁNG
// =====================================================

// Lấy giá dựa vào cycle ('month' hoặc 'year')
function getPlanPrice(planKey, cycle = "month") {
  const plan = getPlan(planKey);
  if (!plan) return null;
  if (!plan.cycles.includes(cycle)) cycle = plan.cycles[0]; // fallback
  let price = plan.price;
  if (cycle === "year" && plan.yearlyDiscount) {
    price = Math.round(price * 12 * (1 - plan.yearlyDiscount)); // giá năm = 12 tháng - discount
  }
  return price;
}

// Tính ngày kết thúc dựa vào cycle
function getPlanEndDateByCycle(user, cycle = "month") {
  const plan = getPlan(user.plan);
  if (!plan) return null;
  const start = new Date(user.planStartDate);
  const end = new Date(start);
  if (cycle === "year") {
    end.setDate(start.getDate() + plan.durationDays * 12); // 12 tháng
  } else {
    end.setDate(start.getDate() + plan.durationDays);
  }
  return end;
}

// =====================================================
// API trả tất cả thông tin plan + user status
// =====================================================
router.get("/plan-status", (req, res) => {
  // Giả lập user lấy từ token/session
  const user = {
    plan: req.query.plan || "free",
    planStartDate: req.query.startDate || new Date().toISOString(),
    cycle: req.query.cycle || "month"
  };

  const planData = getPlan(user.plan);
  const endDate = getPlanEndDateByCycle(user, user.cycle);
  const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
  const purchaseFlags = getPurchaseFlags(user);
  const price = getPlanPrice(user.plan, user.cycle);

  res.json({
    plan: planData,
    planStartDate: user.planStartDate,
    planEndDate: endDate,
    daysLeft: daysLeft > 0 ? daysLeft : 0,
    price,
    cycle: user.cycle,
    ...purchaseFlags
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
module.exports.getPlanEndDateByCycle = getPlanEndDateByCycle;

// =====================================================
// API trả tất cả plan (giống /plans cũ, nhưng bổ sung cycles, yearlyDiscount)
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
    durationDays: plan.durationDays,
    cycles: plan.cycles || ["month"],
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
// API tạo payment (giả lập) cho checkout.js
// =====================================================
router.post("/create-payment", express.json(), (req, res) => {
  const { plan, cycle } = req.body;

  if (!plan || !PLANS[plan]) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  const paymentId = "pay_" + Math.random().toString(36).substring(2, 12);
  const amount = getPlanPrice(plan, cycle || "month");

  // Trả dữ liệu giống frontend cần
  res.json({
    paymentId,
    plan,
    amount,
    content: `Payment for ${plan.toUpperCase()} plan`,
    qrUrl: `/static/qrcode/${paymentId}.png`,
    bank: {
      name: "ABC Bank",
      account: "123456789",
      owner: "Your Company"
    }
  });
});

// =====================================================
// API trả trạng thái thanh toán (giả lập) cho checkout.js
// =====================================================
router.get("/payment-status/:paymentId", (req, res) => {
  const { paymentId } = req.params;

  // Giả lập status ngẫu nhiên (frontend SSE/polling test)
const [rows] = await db.query(
  "SELECT status FROM payments WHERE id = ?",
  [paymentId]
);

if (!rows.length) {
  return res.status(404).json({ error: "Payment not found" });
}

res.json({
  paymentId,
  status: rows[0].status
});

// =====================================================
// SSE cập nhật thanh toán (giả lập) cho checkout.js
// =====================================================
router.get("/payment-stream/:paymentId", (req, res) => {
  const { paymentId } = req.params;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.flushHeaders();

  const statuses = ["pending_review", "paid"];
  let i = 0;

  const interval = setInterval(() => {
    if (i >= statuses.length) {
      clearInterval(interval);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ status: statuses[i] })}\n\n`);
    i++;
  }, 3000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

module.exports = router;