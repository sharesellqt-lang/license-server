const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const db = require("../db");
const { getPlan } = require("../routes/plans");

router.get("/me", auth, async (req, res) => {
  try {
    // Lấy thông tin user
    const [[user]] = await db.query(
      "SELECT id, plan, created_at, expire_at FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    const planKey = user.plan || "free";
    const planData = getPlan(planKey);

    // Tính planStartDate
    let planStartDate;
    if (user.expire_at && planData) {
      planStartDate = new Date(user.expire_at);
      planStartDate.setDate(planStartDate.getDate() - (planData.durationDays || 0));
    } else {
      planStartDate = new Date(user.created_at);
    }
const now = Date.now();

const expireAt = user.expire_at
  ? new Date(user.expire_at)
  : null;

const isLicensed =
  expireAt &&
  expireAt.getTime() > now;

const activePlan =
  isLicensed
    ? (user.plan || "free")
    : "free";

return res.json({
  id: user.id,

  // DB là source of truth
  plan: activePlan,

  licensed: !!isLicensed,

  // dùng biến đã tính đúng
  planStartDate:
    activePlan === "free"
      ? null
      : planStartDate,

  expireAt
});

  } catch (err) {
    console.error("Error in /me:", err);
    return res.status(500).json({ error: "Failed to fetch user info" });
  }
});

module.exports = router;