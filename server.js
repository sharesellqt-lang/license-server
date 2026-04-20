const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const VALID_KEYS = ["PRO123", "VIP999", "ADMIN"];

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
