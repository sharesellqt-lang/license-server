const db =
  require("../db");

const plans =
  require("../services/planConfig");

module.exports =
  (action) => {

    return async (
      req,
      res,
      next
    ) => {

      try {

        const plan =
          req.user.plan || "free";

        const limit =
          plans[plan]
            ?.limits?.[action];

        if (!limit) {
          return next();
        }

        const [rows] =
          await db.query(
            `
            SELECT COUNT(*) as total
            FROM usage_logs
            WHERE user_id = ?
            AND action = ?
            AND DATE(created_at) = CURDATE()
            `,
            [
              req.user.id,
              action
            ]
          );

        const total =
          rows[0].total;

        if (total >= limit) {

          return res.status(403).json({
            error:
              "Daily limit reached"
          });

        }

        await db.query(
          `
          INSERT INTO usage_logs
          (
            user_id,
            action
          )
          VALUES (?, ?)
          `,
          [
            req.user.id,
            action
          ]
        );

        next();

      } catch (err) {

        console.error(err);

        res.status(500).json({
          error:
            "Limit check failed"
        });

      }

    };

  };