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

    const [trials] = await db.query(
  `
  SELECT *
  FROM user_feature_trials
  WHERE user_id = ?
    AND is_active = 1
    AND expires_at > NOW()
  `,
  [user.id]
);

    if (!user) return res.status(404).json({ error: "User not found" });

    const trialFeatures = trials.map(t => t.feature_key);

    const hasProTrial = trialFeatures.includes("proMode");
    const hasVipTrial = trialFeatures.includes("vipMode");

    const planKey =
      hasVipTrial
        ? "vip"
        : hasProTrial
          ? "pro"
          : (user.plan || "free");
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

  plan: planKey,

  licensed: !!isLicensed,

  trialFeatures,

  planStartDate:
    planKey === "free"
      ? null
      : planStartDate,

  expireAt: user.expire_at
});

  } catch (err) {
    console.error("Error in /me:", err);
    return res.status(500).json({ error: "Failed to fetch user info" });
  }
});

module.exports = router;