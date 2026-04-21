const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
mongodb+srv://sharesellqt_db_user:1RMEJMvtsQvDL4pL@license-cluster.y92xgoq.mongodb.net/?appName=license-cluster
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.log("❌ MongoDB error", err));

/* =========================
   HEALTH CHECK (FIX RENDER)
========================= */
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

/* =========================
   LICENSE DB (demo)
========================= */
const LicenseSchema = new mongoose.Schema({
  key: String,
  valid: { type: Boolean, default: true },
  deviceId: { type: String, default: null },
  expireAt: Date
});

const License = mongoose.model("License", LicenseSchema);
/* =========================
   VERIFY
========================= */
app.get("/verify", async (req, res) => {

  const { key, deviceId } = req.query;

  const lic = await License.findOne({ key });

  if (!lic || !lic.valid) {
    return res.json({ valid: false });
  }

  // check expire
  if (lic.expireAt && new Date() > lic.expireAt) {
    return res.json({ valid: false, reason: "EXPIRED" });
  }

  // device lock
  if (lic.deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

  // bind device lần đầu
  if (!lic.deviceId) {
    lic.deviceId = deviceId;
    await lic.save();
  }

  return res.json({ valid: true });
});
app.post("/create", async (req, res) => {

  const { key } = req.body;

  const newKey = new License({
    key,
    expireAt: new Date(Date.now() + 30*24*60*60*1000) // 30 ngày
  });

  await newKey.save();

  res.json({ success: true });
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
