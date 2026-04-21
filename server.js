const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK (FIX RENDER)
========================= */
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

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

  if (!key) {
    return res.json({ valid: false, reason: "NO_KEY" });
  }

  const lic = licenses[key];

  if (!lic || !lic.valid) {
    return res.json({ valid: false, reason: "INVALID_KEY" });
  }

  // nếu có device lock
  if (lic.deviceId && deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

  // bind device lần đầu
  if (!lic.deviceId && deviceId) {
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
   RENDER PORT FIX (CHUẨN)
========================= */
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("License server running on port", PORT);
});
