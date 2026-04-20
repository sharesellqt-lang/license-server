const express = require("express");
const app = express();

// =======================
// CORS FIX (OK)
// =======================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// =======================
// KEY LIST
// =======================
const keys = ["PRO123", "VIP999"];

// =======================
// HEALTH CHECK (QUAN TRỌNG TRÊN RENDER)
// =======================
app.get("/", (req, res) => {
  res.send("Server OK");
});

// =======================
// VERIFY API
// =======================
app.get("/verify", (req, res) => {
  const key = (req.query.key || "").trim();

  res.json({
    valid: keys.includes(key)
  });
});

// =======================
// PORT (RENDER REQUIRE)
// =======================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
