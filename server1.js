const express = require("express");
const app = express();

// =====================
// CORS FIX
// =====================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// handle preflight
app.options("*", (req, res) => {
  res.sendStatus(200);
});

// =====================
// DATA
// =====================
const keys = ["PRO123", "VIP999"];

// =====================
// HEALTH CHECK (RENDER REQUIRE)
// =====================
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// =====================
// ROOT CHECK
// =====================
app.get("/", (req, res) => {
  res.send("Server OK");
});

// =====================
// VERIFY API
// =====================
app.get("/verify", (req, res) => {
  try {
    const key = (req.query.key || "").trim();

    return res.json({
      valid: keys.includes(key)
    });

  } catch (err) {
    return res.status(500).json({
      valid: false,
      error: "server_error"
    });
  }
});

// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
