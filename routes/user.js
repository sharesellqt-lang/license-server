const express = require("express");
const router = express.Router();

// nếu bạn đã có middleware auth
const authMiddleware = require("../middleware/auth");

// ===== GET USER INFO =====
router.get("/me", authMiddleware, async (req, res) => {

  try {

    // req.user đã được decode từ JWT trong authMiddleware
    const user = req.user;

    res.json({
      id: user.id,
      plan: user.plan || "free",
      licensed: true,
      expireAt: user.expireAt || null
    });

  } catch (err) {
    console.log("ME ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }

});

module.exports = router;