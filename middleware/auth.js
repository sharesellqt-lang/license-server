```js
const jwt = require("jsonwebtoken");

const db = require("../db");

module.exports = async (req, res, next) => {

  try {

    // 🔥 lấy authorization header
    const authHeader =
      req.headers.authorization;

    if (!authHeader) {

      return res.status(401).json({
        error: "No token"
      });

    }

    // 🔥 lấy token
    const token =
      authHeader.split(" ")[1];

    if (!token) {

      return res.status(401).json({
        error: "Invalid token"
      });

    }

    // 🔥 verify jwt
    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    // 🔥 query user realtime từ DB
    const [rows] =
      await db.query(
        `
        SELECT
          id,
          plan,
          expire_at
        FROM users
        WHERE id = ?
        `,
        [decoded.id]
      );

    if (!rows.length) {

      return res.status(401).json({
        error: "User not found"
      });

    }

    const user = rows[0];

    // 🔥 default free
    let plan =
      user.plan || "free";

    // 🔥 auto expire + auto downgrade
    if (
      user.expire_at &&
      new Date(user.expire_at) < new Date()
    ) {

      await db.query(
        `
        UPDATE users
        SET
          plan = 'free',
          expire_at = NULL
        WHERE id = ?
        `,
        [user.id]
      );

      plan = "free";

      user.expire_at = null;

    }

    // 🔥 attach user realtime
    req.user = {
      id: user.id,
      plan,
      expireAt: user.expire_at
    };

    next();

  } catch (err) {

    console.error(err);

    return res.status(401).json({
      error: "Invalid token"
    });

  }

};
```
