// =========================
// IMPORT
// =========================
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// =========================
// CONFIG
// =========================
const PORT = process.env.PORT || 10000;

const MONGO_URI = "mongodb://sharesellqt_db_user:1RMEJMvtsQvDL4pL@license-cluster-shard-00-00.y92xgoq.mongodb.net:27017,license-cluster-shard-00-01.y92xgoq.mongodb.net:27017,license-cluster-shard-00-02.y92xgoq.mongodb.net:27017/?ssl=true&replicaSet=atlas-y92xgoq-shard-0&authSource=admin";

const WP_API = "https://sharesell.net/wp-json/wp/v2/posts";

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());

// =========================
// CONNECT MONGO
// =========================
mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(async () => {
  console.log("✅ Mongo connected");

  const exist = await AdminKey.findOne({ key: "vip500" });

if (!exist) {
  await AdminKey.create({
    key: "vip500",
    maxLength: 500
  });
}

  console.log("🔥 Đã tạo key admin");
})
// =========================
  // 🔥 MIGRATE DATA CŨ (chỉ chạy khi chưa có searchText)
  // =========================
  async function fixData() {
  const count = await QA.countDocuments({ searchText: { $exists: false } });
  console.log("Count:", count);
}

fixData();

  if (count > 0) {
    console.log("⚡ Đang migrate searchText cho data cũ...");

    await QA.updateMany(
      { searchText: { $exists: false } },
      [
        {
          $set: {
            searchText: {
              $toLower: "$question"
            }
          }
        }
      ]
    );

    console.log("✅ Migrate hoàn tất");
  } else {
    console.log("✔ Data đã có searchText, bỏ qua migrate");
  }

})
.catch(err => console.log("❌ Mongo error:", err.message));

// =========================
// SCHEMA
// =========================

// License
const License = mongoose.model("License", new mongoose.Schema({
  key: String,
  valid: { type: Boolean, default: true },
  deviceId: String,
  expireAt: Date
}));

// Q&A
const QA = mongoose.model("QA", new mongoose.Schema({
  question: String,
  answer: String,
  searchText: String // 🔥 thêm dòng này
}));

// Admin Keys (🔥 THÊM MỚI)
const AdminKey = mongoose.model("AdminKey", new mongoose.Schema({
  key: String,
  maxLength: Number
}));

// =========================
// HELPER
// =========================
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD") // bỏ dấu tiếng Việt
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function encodeContent(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function addWatermark(html, key) {
  return html.replace(/<\/p>/g,
    `<span style="opacity:0.1;font-size:10px;display:block;text-align:right;">${key}</span></p>`
  );
}

// =========================
// RATE LIMIT
// =========================
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

// =========================
// HEALTH CHECK (QUAN TRỌNG)
// =========================
app.get("/", (req, res) => {
  res.send("ok");
});

app.get("/healthz", (req, res) => {
  res.send("ok");
});

// =========================
// LICENSE API
// =========================

// VERIFY
app.get("/verify", async (req, res) => {

  const { key, deviceId } = req.query;

  if (!key) return res.json({ valid: false });

  const lic = await License.findOne({ key });

  if (!lic || !lic.valid)
    return res.json({ valid: false });

  if (lic.expireAt && new Date() > lic.expireAt)
    return res.json({ valid: false });

  if (lic.deviceId && deviceId && lic.deviceId !== deviceId)
    return res.json({ valid: false });

  if (!lic.deviceId && deviceId) {
    lic.deviceId = deviceId;
    await lic.save();
  }

  res.json({ valid: true });
});

// CREATE LICENSE
app.post("/create", async (req, res) => {

  const { key } = req.body;

  if (!key)
    return res.json({ success: false });

  const exist = await License.findOne({ key });

  if (exist)
    return res.json({ success: false });

  await License.create({
    key,
    expireAt: new Date(Date.now() + 30*24*60*60*1000)
  });

  res.json({ success: true });
});

// =========================
// SECURE POST
// =========================
app.get("/secure-post", async (req, res) => {

  const { key, deviceId, postId } = req.query;

  if (!key || !postId)
    return res.json({ error: "MISSING" });

  if (!checkRate(key))
    return res.json({ error: "RATE_LIMIT" });

  const lic = await License.findOne({ key });

  if (!lic || !lic.valid)
    return res.json({ error: "INVALID" });

  try {
    let wpRes = await fetch(`${WP_API}/${postId}`);

    if (!wpRes.ok)
      return res.json({ error: "WP_FAIL" });

    let post = await wpRes.json();

    let content = addWatermark(post.content.rendered, key);
    content = encodeContent(content);

    res.json({
      title: post.title.rendered,
      content
    });

  } catch (err) {
    console.log(err);
    res.json({ error: "FETCH_FAIL" });
  }
});

// =========================
// SEARCH BOT
// =========================

// SEARCH
app.get("/api/search", async (req, res) => {
  try {
    let q = (req.query.q || "").trim();
    if (!q) return res.json([]);

    let normalized = normalize(q);
    let safe = escapeRegex(normalized);

    let data = await QA.find({
      $or: [
        { searchText: { $regex: safe, $options: "i" } },
        { question: { $regex: q, $options: "i" } },
        { answer: { $regex: q, $options: "i" } }
      ]
    }).limit(20);

    res.json(data);

  } catch (err) {
    console.log(err);
    res.json([]);
  }
});
// SAVE
app.post("/api/save", async (req, res) => {

  const { question, answer, password } = req.body;

  if (!question || !answer)
    return res.json({ success: false, msg: "Thiếu dữ liệu" });

  if (question.length > 200)
    return res.json({ success: false, msg: "Q max 200 ký tự" });

  // 🔥 THAY ĐOẠN NÀY
  const admin = await AdminKey.findOne({ key: password });

  if (!admin) {
    return res.json({ success:false, msg:"Sai mật khẩu" });
  }

  // 🔥 dùng maxLength từ DB
  if (answer.length > admin.maxLength) {
    return res.json({
      success: false,
      msg: `Tối đa ${admin.maxLength} ký tự`
    });
  }

  await QA.create({
    question,
    answer,
    searchText: normalize(question)
  });

  res.json({ success: true });
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log("🚀 Server chạy port", PORT);
});