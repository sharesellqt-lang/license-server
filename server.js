// =========================
// IMPORT
// =========================
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

// fetch (Render compatible)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

// =========================
// CONFIG
// =========================
const PORT = process.env.PORT || 10000;

// 🔐 password cho search bot
const ADMIN_PASS = "123456";

// WP API
const WP_API = "https://sharesell.net/wp-json/wp/v2/posts";

// =========================
// MIDDLEWARE
// =========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());
app.use(express.json());

// =========================
// MYSQL (ALL SYSTEM)
// =========================
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Chuanday@79",
  database: "igoiiqkjhosting_licensesbot",
  charset: "utf8mb4",
  connectionLimit: 5
});

db.getConnection((err, conn) => {
  if (err) {
    console.log("❌ MySQL lỗi:", err);
  } else {
    console.log("✅ MySQL connected");
    conn.release();
  }
});

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
// HELPER
// =========================
function encodeContent(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function addWatermark(html, key) {
  return html.replace(/<\/p>/g, `
    <span style="opacity:0.1;font-size:10px;display:block;text-align:right;">
      ${key}
    </span></p>
  `);
}

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("🚀 API running");
});

app.get("/healthz", (req, res) => {
  res.send("ok");
});

// =========================
// LICENSE (MYSQL)
// =========================

// VERIFY
app.get("/verify", (req, res) => {

  const { key, deviceId } = req.query;

  if (!key)
    return res.json({ valid: false, reason: "NO_KEY" });

  db.query(
    "SELECT * FROM licenses WHERE license_key = ? LIMIT 1",
    [key],
    (err, results) => {

      if (err || results.length === 0)
        return res.json({ valid: false, reason: "INVALID_KEY" });

      let lic = results[0];

      if (!lic.valid)
        return res.json({ valid: false, reason: "INVALID_KEY" });

      if (lic.expire_at && new Date() > new Date(lic.expire_at))
        return res.json({ valid: false, reason: "EXPIRED" });

      if (lic.device_id && deviceId && lic.device_id !== deviceId)
        return res.json({ valid: false, reason: "DEVICE_LOCKED" });

      // bind device
      if (!lic.device_id && deviceId) {
        db.query(
          "UPDATE licenses SET device_id=? WHERE id=?",
          [deviceId, lic.id]
        );
      }

      res.json({ valid: true });
    }
  );
});

// CREATE LICENSE
app.post("/create", (req, res) => {

  const { key } = req.body;

  if (!key)
    return res.json({ success: false, error: "NO_KEY" });

  db.query(
    "SELECT id FROM licenses WHERE license_key=? LIMIT 1",
    [key],
    (err, results) => {

      if (results.length > 0)
        return res.json({ success: false, error: "EXISTS" });

      db.query(
        "INSERT INTO licenses (license_key, expire_at) VALUES (?, ?)",
        [key, new Date(Date.now() + 30*24*60*60*1000)],
        (err2) => {

          if (err2)
            return res.json({ success: false });

          res.json({ success: true });
        }
      );
    }
  );
});

// REVOKE
app.post("/revoke", (req, res) => {

  const { key } = req.body;

  db.query(
    "UPDATE licenses SET valid=0 WHERE license_key=?",
    [key],
    () => {
      res.json({ success: true });
    }
  );
});

// =========================
// SECURE POST
// =========================
app.get("/secure-post", async (req, res) => {

  const { key, deviceId, postId } = req.query;

  if (!key || !postId)
    return res.json({ error: "MISSING_PARAMS" });

  if (!checkRate(key))
    return res.json({ error: "RATE_LIMIT" });

  db.query(
    "SELECT * FROM licenses WHERE license_key=? LIMIT 1",
    [key],
    async (err, results) => {

      if (err || results.length === 0)
        return res.json({ error: "INVALID_KEY" });

      let lic = results[0];

      if (!lic.valid)
        return res.json({ error: "INVALID_KEY" });

      if (lic.device_id && lic.device_id !== deviceId)
        return res.json({ error: "DEVICE_LOCKED" });

      if (!lic.device_id && deviceId) {
        db.query(
          "UPDATE licenses SET device_id=? WHERE id=?",
          [deviceId, lic.id]
        );
      }

      try {
        let wpRes = await fetch(`${WP_API}/${postId}`);

        if (!wpRes.ok)
          return res.json({ error: "WP_BLOCKED" });

        let post = await wpRes.json();

        if (!post || !post.content)
          return res.json({ error: "POST_NOT_FOUND" });

        let content = post.content.rendered;

        content = addWatermark(content, key);
        content = encodeContent(content);

        res.json({
          title: post.title.rendered,
          content
        });

      } catch (err) {
        console.log("FETCH ERROR:", err);
        res.json({ error: "FETCH_FAILED" });
      }
    }
  );
});

// =========================
// 🔍 SEARCH BOT
// =========================

// SEARCH
app.get("/api/search", (req, res) => {

  let q = (req.query.q || "").trim();

  if (!q) return res.json([]);

  db.query(
    "SELECT id, question, answer FROM qa_data WHERE question LIKE ? LIMIT 20",
    [`%${q}%`],
    (err, results) => {

      if (err) {
        console.log("SEARCH ERROR:", err);
        return res.json([]);
      }

      res.json(results);
    }
  );
});

// SAVE
app.post("/api/save", (req, res) => {

  const { question, answer, password } = req.body;

  if (!question || !answer)
    return res.json({ success: false, msg: "Thiếu dữ liệu" });

  if (question.length > 200)
    return res.json({ success: false, msg: "Q max 200 ký tự" });

  if (answer.length > 500)
    return res.json({ success: false, msg: "A max 500 ký tự" });

  if (password !== ADMIN_PASS)
    return res.json({ success: false, msg: "Sai mật khẩu" });

  db.query(
    "INSERT INTO qa_data (question, answer) VALUES (?, ?)",
    [question, answer],
    (err, result) => {

      if (err) {
        console.log("SAVE ERROR:", err);
        return res.json({ success: false });
      }

      res.json({
        success: true,
        id: result.insertId
      });
    }
  );
});

// =========================
// START
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server LIVE on port", PORT);
});