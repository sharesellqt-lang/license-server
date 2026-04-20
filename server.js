const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   LICENSE DB (demo)
========================= */
let licenses = {
  "ABC-123": { valid: true, deviceId: null },
  "PRO-999": { valid: true, deviceId: null }
};

/* =========================
   VERIFY
========================= */
app.get("/verify", (req, res) => {

  const { key, deviceId } = req.query;

  const lic = licenses[key];

  if (!lic || !lic.valid) {
    return res.json({ valid: false });
  }

  if (lic.deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

  if (!lic.deviceId) {
    lic.deviceId = deviceId;
  }

  return res.json({ valid: true });
});

/* =========================
   REVOKE
========================= */
app.post("/revoke", (req, res) => {

  const { key } = req.body;

  if (licenses[key]) {
    licenses[key].valid = false;
  }

  res.json({ success: true });
});

/* =========================
   RENDER PORT FIX
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("License server running on port", PORT);
});
