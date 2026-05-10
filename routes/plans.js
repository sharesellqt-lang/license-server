// =========================================================
// 🔥 SINGLE SOURCE OF TRUTH - PLANS
// =========================================================

const PLANS = {

  pro: {
    id: "pro",
    name: "🔥 PRO PLAN",
    shortName: "PRO",
    price: 15000,
    currency: "VND",
    displayPrice: "15.000đ",
    displayMonthly: "15.000đ / month",

    // 🔥 TEMPLATE ONLY (KHÔNG DÙNG TRỰC TIẾP Ở FRONTEND)
    notePrefix: "PRO_ORDER"
  },

  vip: {
    id: "vip",
    name: "🚀 VIP PLAN",
    shortName: "VIP",
    price: 30000,
    currency: "VND",
    displayPrice: "30.000đ",
    displayMonthly: "30.000đ / month",

    notePrefix: "VIP_ORDER"
  }
};

// =========================================================
// 🔥 FORMAT PAYMENT NOTE (QUAN TRỌNG NHẤT)
// =========================================================

function buildPaymentContent(planKey, userId, paymentId) {

  const plan = PLANS[planKey];

  if (!plan) return null;

  // 🔥 FORMAT CHUẨN DUY NHẤT (BACKEND + FRONTEND ĐỀU PHẢI HIỂU)
  return `${plan.notePrefix}_${userId}_${paymentId}`;
}

// =========================================================
// 🔥 FORMAT QR SAFE (KHÔNG MẤT "_")
// =========================================================

function buildQRContent(content) {

  if (!content) return "";

  // 🔥 CHỈ encodeURIComponent, KHÔNG strip "_"
  return encodeURIComponent(content);
}

// =========================================================
// 🔥 EXPORT (NODE BACKEND)
// =========================================================

if (typeof module !== "undefined") {
  module.exports = {
    PLANS,
    buildPaymentContent,
    buildQRContent
  };
}

// =========================================================
// 🔥 FRONTEND SAFE ACCESS
// =========================================================

window.PLANS = PLANS;
window.buildPaymentContent = buildPaymentContent;