// =========================
// IMPORT
// =========================
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();

// =========================
// CONFIG
// =========================
const PORT = process.env.PORT || 10000;
const ADMIN_SECRET = "123456";

const WP_API = "https://sharesell.net/wp-json/wp/v2/posts";

// =========================
// MIDDLEWARE
// =========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-admin"]
}));

app.use(express.json());

// =========================
// DB CONNECT (POOL)
// =========================
const db = mysql.createPool({
  host: "onehost-amdcloudhn022602.000nethost.com",
  user: "igoiiqkjhosting_bot-license",
  password: "Chucaolamday@179",
  database: "igoiiqkjhosting_bot-license",
  waitForConnections: true,
  connectionLimit: 10
});

console.log("✅ MySQL pool ready");

async function initDB() {
  try {
    let [rows] = await db.execute(
      "SELECT * FROM admin_keys WHERE `key`=?",
      ["vip500"]
    );

    if (rows.length === 0) {
      await db.execute(
        "INSERT INTO admin_keys (`key`, maxLength) VALUES (?, ?)",
        ["vip500", 500]
      );
      console.log("🔥 Đã tạo key admin");
    }

  } catch (err) {
    console.log("❌ DB INIT ERROR:", err);
  }
}

// 🔥 INIT ADMIN KEY (bọc async)
(async () => {
  try {
    let [rows] = await db.execute(
      "SELECT * FROM admin_keys WHERE `key`=?",
      ["vip500"]
    );

    if (rows.length === 0) {
      await db.execute(
        "INSERT INTO admin_keys (`key`, maxLength) VALUES (?, ?)",
        ["vip500", 500]
      );
      console.log("🔥 Đã tạo key admin");
    }
  } catch (err) {
    console.log("❌ INIT ERROR:", err);
  }
})();

// =========================
// AUTO DISABLE EXPIRED KEYS
// =========================
async function disableExpiredKeys() {
  try {
    await db.execute(`
      UPDATE licenses 
      SET valid = 0 
      WHERE expireAt IS NOT NULL 
      AND expireAt < NOW()
    `);

    console.log("🧹 Auto disable expired keys done");
  } catch (err) {
    console.log("❌ Auto disable error:", err);
  }
}

// chạy mỗi 5 phút
setInterval(disableExpiredKeys, 5 * 60 * 1000);

// =========================
// HELPER
// =========================
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeContent(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function addWatermark(html, key) {
  return html.replace(
    /<\/p>/g,
    `<span style="opacity:0.1;font-size:10px;text-align:right;display:block;">${key}</span></p>`
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
// HEALTH
// =========================
app.get("/", (req, res) => res.send("ok"));
app.get("/healthz", (req, res) => res.send("ok"));

// =========================
// VERIFY LICENSE
// =========================
app.get("/verify", async (req, res) => {
  try {
    const { key, deviceId } = req.query;

    let [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length === 0) return res.json({ valid: false });

    let lic = rows[0];

    if (!lic.valid) return res.json({ valid: false });

    if (lic.expireAt && new Date() > new Date(lic.expireAt))
      return res.json({ valid: false });

    if (!lic.deviceId && deviceId) {
      await db.execute(
        "UPDATE licenses SET deviceId=? WHERE id=?",
        [deviceId, lic.id]
      );
    }

    res.json({ valid: true });

  } catch (err) {
    console.log(err);
    res.json({ valid: false });
  }
});

// =========================
// CREATE LICENSE
// =========================
app.post("/create", async (req, res) => {
  try {
    const { key, days } = req.body;

    let [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length > 0)
      return res.json({ success: false, msg: "Key đã tồn tại" });

    // ⏰ tính thời gian hết hạn
    const expireAt = new Date(
      Date.now() + (days || 30) * 24 * 60 * 60 * 1000
    );

    await db.execute(
      "INSERT INTO licenses (`key`, expireAt, valid) VALUES (?, ?, 1)",
      [key, expireAt]
    );

    res.json({ success: true, expireAt });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

app.get("/secure-post", async (req, res) => {
  try {
    const { key, deviceId, postId } = req.query;

    if (!key || !postId) {
      return res.json({ error: "MISSING" });
    }

    // 🔐 check license
    let [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length === 0) {
      return res.json({ error: "INVALID" });
    }

    let lic = rows[0];

    if (!lic.valid) {
      return res.json({ error: "INVALID" });
    }

    if (lic.expireAt && new Date() > new Date(lic.expireAt)) {
      return res.json({ error: "EXPIRED" });
    }

    // 🔥 gọi WordPress API
    const wpRes = await fetch(`${WP_API}/${postId}`);

    if (!wpRes.ok) {
      return res.json({ error: "WP_FAIL" });
    }

    const post = await wpRes.json();

    // 🔥 watermark
    let content = addWatermark(post.content.rendered, key);

    // 🔥 encode base64
    content = encodeContent(content);

    res.json({
      title: post.title.rendered,
      content
    });

  } catch (err) {
    console.log("SECURE POST ERROR:", err);
    res.json({ error: "SERVER_ERROR" });
  }
});
// =========================
// SEARCH
// =========================
app.get("/api/search", async (req, res) => {
  try {
    const { q, key, category } = req.query;

    // 🚫 bắt buộc có key
    if (!key) return res.json({ error: "NO_KEY" });

    // 🚫 bắt buộc có category
    if (!category) return res.json({ error: "NO_CATEGORY" });

    // 🔐 check license
    let [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length === 0)
      return res.json({ error: "INVALID_KEY" });

    let lic = rows[0];

    if (!lic.valid)
      return res.json({ error: "DISABLED" });

    if (lic.expireAt && new Date() > new Date(lic.expireAt))
      return res.json({ error: "EXPIRED" });

    // 🚫 rate limit
    if (!checkRate(key))
      return res.json({ error: "RATE_LIMIT" });

    let query = (q || "").trim();

    // ❗ chặn search rác
    if (query && query.length < 2) {
      return res.json({ error: "QUERY_TOO_SHORT" });
    }

    let data;

    // 🔥 nếu KHÔNG nhập q → chỉ lấy danh mục
    if (!query) {
      let [rows] = await db.execute(
        "SELECT * FROM qa_data WHERE category = ? LIMIT 20",
        [category]
      );
      data = rows;
    } else {
      let normalized = normalize(query);

      let [rows] = await db.execute(
        `
        SELECT * FROM qa_data
        WHERE category = ?
        AND (
          searchText LIKE ?
          OR question LIKE ?
          OR answer LIKE ?
        )
        LIMIT 20
        `,
        [`%${normalized}%`, `%${query}%`, `%${query}%`]
      );

      data = rows;
    }

    res.json({ data });

  } catch (err) {
    console.log("SEARCH ERROR:", err);
    res.json({ error: "SERVER_ERROR" });
  }
});

// =========================
// SAVE
// =========================
app.post("/api/save", async (req, res) => {
  try {
    console.log("🔥 SAVING TO MYSQL");

    const { question, answer, password } = req.body;

    if (!question || !answer)
      return res.json({ success: false, msg: "Thiếu dữ liệu" });

    if (question.length > 200)
      return res.json({ success: false, msg: "Q max 200 ký tự" });

    let [rows] = await db.execute(
      "SELECT * FROM admin_keys WHERE `key`=?",
      [password]
    );

    if (rows.length === 0)
      return res.json({ success: false, msg: "Sai mật khẩu" });

    let admin = rows[0];

    if (answer.length > admin.maxLength)
      return res.json({
        success: false,
        msg: `Tối đa ${admin.maxLength} ký tự`
      });

    await db.execute(
      "INSERT INTO qa_data (question, answer, searchText) VALUES (?, ?, ?)",
      [question, answer, normalize(question)]
    );

    console.log("✅ INSERT DONE");

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

// =========================
// START SERVER
// =========================
initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Server chạy port", PORT);
  });
});