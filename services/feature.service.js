const permissions =
require("../permissions/tool.permissions");

const { PLANS } =
require("../routes/plans");

const db =
require("../db");

async function canAccessFeature(user, feature) {

  const config = permissions.features?.[feature];
  if (!config) return false;

  // ======================
  // 1. CHECK TRIAL FIRST (QUAN TRỌNG)
  // ======================
  const [trialRows] = await db.query(
    `
    SELECT id
    FROM user_feature_trials
    WHERE user_id = ?
      AND feature_key = ?
      AND is_active = 1
      AND expires_at > NOW()
    LIMIT 1
    `,
    [user.id, feature]
  );

  if (trialRows.length > 0) {
    return true; // 🔥 OVERRIDE PLAN
  }

  // ======================
  // 2. CHECK PLAN SAU
  // ======================
  const userLevel =
    PLANS[user.plan || "free"]?.level || 0;

  const requiredLevel =
    PLANS[config.requiredPlan]?.level || 0;

  return userLevel >= requiredLevel;
}

module.exports = {
  canAccessFeature
};