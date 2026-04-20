const express = require("express");
const app = express();

// ✅ FIX CORS (QUAN TRỌNG NHẤT)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// 🔑 KEY
const keys = ["PRO123", "VIP999"];

// API VERIFY
app.get("/verify", (req, res) => {
  const key = req.query.key;

  if (keys.includes(key)) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

// PORT RENDER
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
