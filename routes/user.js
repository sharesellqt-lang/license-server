const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/auth");

router.get("/me", authMiddleware, async (req, res) => {

  try {

    res.json({
      id: req.user.id,
      plan: req.user.plan || "free",
      licensed: true,
      expireAt: req.user.expireAt || null
    });

  } catch (err) {

    console.log("ME ERROR:", err);

    res.status(500).json({
      error: "Server error"
    });

  }

});

module.exports = router;