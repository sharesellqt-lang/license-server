const jwt = require("jsonwebtoken");
const db = require("../db"); // 🔥 bạn cần có hàm getUserById

module.exports = async function (req, res, next) {

  try {

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    // 🔥 decode token (chỉ lấy id)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.id) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // 🔥 lấy user thật từ DB
    const user = await db.getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // 🔥 check expire (nếu có)
    let plan = user.plan || "free";

    if (user.expireAt && new Date(user.expireAt) < new Date()) {
      plan = "free";
    }

    // 🔥 attach vào request (CHUẨN)
    req.user = {
      id: user.id,
      plan: plan,
      expireAt: user.expireAt || null
    };

    next();

  } catch (err) {

    console.log("AUTH ERROR:", err);

    return res.status(401).json({ error: "Unauthorized" });
  }
};