const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");

router.post("/upgrade", authMiddleware, async (req, res) => {

  const { plan } = req.body;

  if (!["pro", "vip"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {

    await db.query(
      "UPDATE users SET plan = ? WHERE id = ?",
      [plan, req.user.id]
    );

    res.json({ success: true });

  } catch (err) {
    console.log("UPGRADE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }

});

module.exports = router;