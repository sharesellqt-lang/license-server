const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

// fake database key
const VALID_KEYS = ["PRO123", "VIP999", "ADMIN"];

app.get("/", (req, res) => {
  res.send("License Server Running 🚀");
});

app.get("/healthz", (req, res) => {
  res.send("OK");
});

// 🔐 API CHECK KEY
app.get("/verify", (req, res) => {
  const key = req.query.key;

  if (VALID_KEYS.includes(key)) {
    return res.json({ valid: true });
  }

  return res.json({ valid: false });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
