const permissions =
require("../permissions/tool.permissions");

const {
  PLANS
} = require("../routes/plans");

function canAccessFeature(
  user,
  feature
) {

  const config =
    permissions.features[
      feature
    ];

  if (!config) {

    return false;

  }

  const userLevel =
    PLANS[
      user.plan || "free"
    ]?.level || 0;

  const requiredLevel =
    PLANS[
      config.requiredPlan
    ]?.level || 0;

  if (
    userLevel >=
    requiredLevel
  ) {

    return true;

  }

  const trial =
    user.activeTrial;

  if (

    trial?.feature ===
      feature &&

    new Date(
      trial.expiresAt
    ) > new Date()

  ) {

    return true;

  }

  return false;

}

module.exports = {

  canAccessFeature

};