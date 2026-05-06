const express = require("express");
const router = express.Router();
console.log("🔥 user route loaded");

const authMiddleware = require("../middleware/auth");

router.get("/me", authMiddleware, async (req, res) => {
  try {

    const user = req.user;

    let plan = user.plan || "free";

    // 🔥 check expire
    if (user.expireAt && new Date(user.expireAt) < new Date()) {
      plan = "free";
    }

    res.json({
      id: user.id,
      plan: plan,
      licensed: plan !== "free",
      expireAt: user.expireAt || null
    });

  } catch (err) {
    console.log("ME ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
module.exports = router;