const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();
app.get("/ip", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  console.log("REAL IP:", ip);

  res.send(ip);
});

// ✅ FIX: dùng fetch ổn định cho Node (Render)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* =========================
   CONFIG
========================= */
const WP_API = "https://sharesell.net/wp-json/wp/v2/posts";

/* =========================
   MIDDLEWARE
========================= */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors()); // 🔥 QUAN TRỌNG (fix preflight)

app.use(express.json());

/* =========================
   RATE LIMIT
========================= */
const rateLimit = {};

function checkRate(key) {
  const now = Date.now();

  if (!rateLimit[key]) {
    rateLimit[key] = { count: 1, time: now };
    return true;
  }

  if (now - rateLimit[key].time > 60000) {
    rateLimit[key] = { count: 1, time: now };
    return true;
  }

  rateLimit[key].count++;

  return rateLimit[key].count <= 30;
}

/* =========================
   ENCODE + WATERMARK
========================= */
function encodeContent(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function addWatermark(html, key) {
  return html.replace(/<\/p>/g, `
    <span style="
      opacity:0.1;
      font-size:10px;
      display:block;
      text-align:right;
    ">${key}</span></p>
  `);
}

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
.then(() => {
  console.log("✅ MongoDB connected");
})
.catch(err => {
  console.error("❌ MongoDB FAILED:", err.message);
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

  if (lic.expireAt && new Date() > lic.expireAt) {
    return res.json({ valid: false, reason: "EXPIRED" });
  }

  if (lic.deviceId && deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

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
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  await newKey.save();

  res.json({ success: true });
});

/* =========================
   REVOKE
========================= */
app.post("/revoke", async (req, res) => {

  const { key } = req.body;

  await License.updateOne({ key }, { valid: false });

  res.json({ success: true });
});

/* =========================
   SECURE POST
========================= */
app.get("/secure-post", async (req, res) => {

  const { key, deviceId, postId } = req.query;

  if (!key || !postId) {
    return res.json({ error: "MISSING_PARAMS" });
  }

  // ✅ rate limit
  if (!checkRate(key)) {
    return res.json({ error: "RATE_LIMIT" });
  }

  // ✅ verify license
  const lic = await License.findOne({ key });

  if (!lic || !lic.valid) {
    return res.json({ error: "INVALID_KEY" });
  }

  if (lic.deviceId && lic.deviceId !== deviceId) {
    return res.json({ error: "DEVICE_LOCKED" });
  }

  if (!lic.deviceId && deviceId) {
    lic.deviceId = deviceId;
    await lic.save();
  }

  // ✅ log (trace leak)
  console.log({
    key,
    deviceId,
    postId,
    ip: req.ip
  });

  try {
    // ✅ fetch từ WP
  // ✅ code mới (an toàn)
let wpRes = await fetch(`${WP_API}/${postId}`);

if (!wpRes.ok) {
  console.log("WP STATUS:", wpRes.status);
  return res.json({ error: "WP_BLOCKED" });
}

let post = await wpRes.json();

if (!post || !post.content) {
  return res.json({ error: "POST_NOT_FOUND" });
}

let content = post.content.rendered;

// watermark
content = addWatermark(content, key);

// encode
content = encodeContent(content);

res.json({
  title: post.title.rendered,
  content
});

  } catch (err) {
    console.log("FETCH ERROR:", err);
    res.json({ error: "FETCH_FAILED" });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server LIVE on port", PORT);
});