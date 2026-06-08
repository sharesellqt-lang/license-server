const permissions =
require("../permissions/tool.permissions");

const { PLANS } =
require("../routes/plans");

const db =
require("../db");

async function canAccessFeature(
  user,
  feature
) {

  const config =
    permissions.features?.[
      feature
    ];

  if (!config) return false;

  // =========================
  // 1. CHECK PLAN LEVEL-update
  // =========================
  const userLevel =
    PLANS[user.plan || "free"]?.level || 0;

  const requiredLevel =
    PLANS[config.requiredPlan]?.level || 0;

  if (userLevel >= requiredLevel) {
    return true;
  }

  // =========================
  // 2. CHECK TRIAL TABLE (IMPORTANT FIX)
  // =========================
  const [rows] = await db.query(
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

  if (rows.length > 0) {
    return true;
  }

  return false;
}

module.exports = {
  canAccessFeature
};