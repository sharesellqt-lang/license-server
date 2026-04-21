const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

/* =========================
   CONNECT MONGODB
========================= */
mongoose.connect(
  "mongodb+srv://sharesellqt_db_user:1RMEJMvtsQvDL4pL@license-cluster.y92xgoq.mongodb.net/?appName=license-cluster",
  { serverSelectionTimeoutMS: 5000 }
)
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB FAILED:", err.message));

/* =========================
   ADMIN ROUTES (CHỈ 1 LẦN)
========================= */
const adminRoutes = require("./admin");
app.use("/admin", adminRoutes);

/* =========================
   MODELS
========================= */

// USER MODEL
const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  licenseKey: String
});

const User = mongoose.model("User", UserSchema);

// LICENSE MODEL
const LicenseSchema = new mongoose.Schema({
  key: String,
  valid: { type: Boolean, default: true },
  devices: { type: [String], default: [] },
  expireAt: Date,
  userId: mongoose.Schema.Types.ObjectId
});

const License = mongoose.model("License", LicenseSchema);

/* =========================
   VERIFY (SAAS CORE)
========================= */
app.get("/verify", async (req, res) => {

  const { key, deviceId } = req.query;

  const license = await License.findOne({ key });

  if (!license) {
    return res.json({ valid: false, reason: "INVALID_KEY" });
  }

  if (!license.valid) {
    return res.json({ valid: false, reason: "DISABLED" });
  }

  if (license.expireAt && new Date() > license.expireAt) {
    return res.json({ valid: false, reason: "EXPIRED" });
  }

  if (!license.devices.includes(deviceId)) {

    if (license.devices.length >= 3) {
      return res.json({ valid: false, reason: "DEVICE_LIMIT" });
    }

    license.devices.push(deviceId);
    await license.save();
  }

  return res.json({ valid: true });
});

/* =========================
   ADMIN CREATE USER + LICENSE
========================= */
app.post("/admin/create-user", async (req, res) => {

  const { email, password, key } = req.body;

  const user = await User.create({
    email,
    password,
    licenseKey: key
  });

  await License.create({
    key,
    userId: user._id,
    devices: []
  });

  res.json({ success: true });
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
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    devices: []
  });

  await newKey.save();

  res.json({ success: true });
});

/* =========================
   REVOKE LICENSE
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