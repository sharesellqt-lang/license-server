const db = require("../db");

module.exports = (
  action,
  maxPerDay
) => {

  return async (req, res, next) => {

    try {

      const [rows] = await db.query(
        `
        SELECT COUNT(*) as total
        FROM usage_logs
        WHERE userId = ?
        AND action = ?
        AND DATE(createdAt) = CURDATE()
        `,
        [
          req.user.id,
          action
        ]
      );

      if (rows[0].total >= maxPerDay) {

        return res.status(403).json({
          error: "Daily limit reached"
        });

      }

      await db.query(
        `
        INSERT INTO usage_logs
        (userId, action)
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

      return res.status(500).json({
        error: "Usage check failed"
      });

    }

  };

};