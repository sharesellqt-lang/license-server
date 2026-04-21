const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   CONNECT MONGODB (FIX)
========================= */
mongoose.connect("mongodb+srv://sharesellqt_db_user:1RMEJMvtsQvDL4pL@cluster.mongodb.net/license_db", {
  serverSelectionTimeoutMS: 5000
})
.then(() => {
  console.log("✅ MongoDB connected");
})
.catch(err => {
  console.error("❌ MongoDB FAILED:", err.message);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server LIVE on port", PORT);
});
/* =========================
   HEALTH CHECK
========================= */
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

/* =========================
   SCHEMA
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

  if (!key) {
    return res.json({ valid: false, reason: "NO_KEY" });
  }

  const lic = await License.findOne({ key });

  if (!lic || !lic.valid) {
    return res.json({ valid: false, reason: "INVALID_KEY" });
  }

  // check expire
  if (lic.expireAt && new Date() > lic.expireAt) {
    return res.json({ valid: false, reason: "EXPIRED" });
  }

  // device lock
  if (lic.deviceId && deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

  // bind device lần đầu
  if (!lic.deviceId && deviceId) {
    lic.deviceId = deviceId;
    await lic.save();
  }

  return res.json({ valid: true });
});

/* =========================
   CREATE LICENSE
========================= */
app.post("/create", async (req, res) => {

  const { key } = req.body;

  if (!key) {
    return res.json({ success: false, error: "NO_KEY" });
  }

  const exist = await License.findOne({ key });

  if (exist) {
    return res.json({ success: false, error: "EXISTS" });
  }

  const newKey = new License({
    key,
    expireAt: new Date(Date.now() + 30*24*60*60*1000)
  });

  await newKey.save();

  res.json({ success: true });
});

/* =========================
   REVOKE (FIX)
========================= */
app.post("/revoke", async (req, res) => {

  const { key } = req.body;

  await License.updateOne({ key }, { valid: false });

  res.json({ success: true });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server LIVE on port", PORT);
});