module.exports = (requiredPlan) => {

  return (req, res, next) => {

    const levels = {
      free: 0,
      pro: 1,
      vip: 2
    };

    const current =
      levels[req.user.plan] || 0;

    const needed =
      levels[requiredPlan] || 0;

    if (current < needed) {
      return res.status(403).json({
        error: "Upgrade required"
      });
    }

    next();

  };

};