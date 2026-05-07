const plans =
  require("../services/planConfig");

module.exports =
  (feature) => {

    return (
      req,
      res,
      next
    ) => {

      const plan =
        req.user.plan || "free";

      const allowed =
        plans[plan]
          ?.features
          ?.includes(feature);

      if (!allowed) {

        return res.status(403).json({
          error:
            "Feature locked"
        });

      }

      next();

    };

  };