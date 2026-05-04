// =========================
// IMPORT
// =========================
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const app = express();

// =========================
// CONFIG
// =========================
const PORT = process.env.PORT || 10000;
// 🔥 THÊM
require("dotenv").config();

const { OAuth2Client } = require("google-auth-library");

// 🔐 ENV
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ❗ CHECK
if (!GOOGLE_CLIENT_ID) {
  throw new Error("❌ GOOGLE_CLIENT_ID missing");
}

if (!JWT_SECRET) {
  throw new Error("❌ JWT_SECRET missing");
}

// ✅ INIT
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// 🔐 ADMIN
const ADMIN_SECRET = process.env.ADMIN_SECRET || "123456";

// 🔍 DEBUG
console.log("🔥 GOOGLE_CLIENT_ID:", GOOGLE_CLIENT_ID);
console.log("🔥 JWT_SECRET:", JWT_SECRET ? "OK" : "MISSING");

const WP_API = "https://sharesell.net/wp-json/wp/v2/posts";

// =========================
// MIDDLEWARE
// =========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin"]
}));
app.options("*", cors());
app.use(express.json());

// =========================
// AUTH GOOGLE (🔥 đặt ở đây)
// =========================
app.post("/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    const email = payload.email;
    const googleId = payload.sub;

    // 🔥 TODO: thay bằng MySQL của bạn
    let user = await findUserByEmail(email);

    if (!user) {
      user = await createUser(email, googleId);
    }

    const jwtToken = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token: jwtToken });

  } catch (err) {
    console.log("GOOGLE AUTH ERROR:", err);
    res.status(401).json({ error: "AUTH_FAILED" });
  }
});

// =========================
// AUTH MIDDLEWARE
// =========================
function authMiddleware(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "NO_TOKEN" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // 🔥 gắn user vào request

    next();

  } catch (err) {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

// =========================
// REDEEM KEY
// =========================
app.post("/redeem", authMiddleware, async (req, res) => {
  try {
    const { key } = req.body;
    const userId = req.user.userId;

    if (!key) {
      return res.json({ success: false, msg: "MISSING_KEY" });
    }

    // 🔍 tìm key cũ
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length === 0) {
      return res.json({ success: false, msg: "INVALID_KEY" });
    }

    const lic = rows[0];

    if (!lic.valid) {
      return res.json({ success: false, msg: "KEY_USED" });
    }

    if (lic.expireAt && new Date() > new Date(lic.expireAt)) {
      return res.json({ success: false, msg: "EXPIRED" });
    }

    // 🔥 GẮN KEY VÀO USER
    await db.execute(
      "UPDATE licenses SET user_id=?, valid=1 WHERE id=?",
      [userId, lic.id]
    );

    res.json({ success: true });

  } catch (err) {
    console.log("REDEEM ERROR:", err);
    res.json({ success: false, msg: "SERVER_ERROR" });
  }
});

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

async function findUserByEmail(email) {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE email=?",
    [email]
  );
  return rows[0];
}
//login google
async function createUser(email, googleId) {
  const [result] = await db.execute(
    "INSERT INTO users (email, google_id) VALUES (?, ?)",
    [email, googleId]
  );

  return {
    id: result.insertId,
    email
  };
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
    const { key } = req.body;

    let [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length > 0)
      return res.json({ success: false });

    await db.execute(
      "INSERT INTO licenses (`key`, expireAt) VALUES (?, ?)",
      [key, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});
//thay đổi
app.get("/secure-post", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.query;

    if (!postId) {
      return res.json({ error: "MISSING" });
    }

    // 🔥 lấy user từ JWT
    const userId = req.user.userId;

    // 🔐 check license theo USER
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE user_id=? AND valid=1",
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ error: "NO_LICENSE" });
    }

    const lic = rows[0];

    // ⏰ check expire
    if (lic.expireAt && new Date() > new Date(lic.expireAt)) {
      return res.json({ error: "EXPIRED" });
    }

    // 🌐 gọi WordPress
    const wpRes = await fetch(`${WP_API}/${postId}`);

    if (!wpRes.ok) {
      return res.json({ error: "WP_FAIL" });
    }

    const post = await wpRes.json();

    // 🔥 watermark theo user (không còn key)
    let content = addWatermark(post.content.rendered, userId);

    // 🔒 encode
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
// ME (USER INFO)
// =========================
app.get("/me", authMiddleware, async (req, res) => {
  try {

    const userId = req.user.userId;

    // 🔍 tìm license của user
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE user_id=? AND valid=1",
      [userId]
    );

    if (rows.length === 0) {
      return res.json({
        userId,
        licensed: false
      });
    }

    const lic = rows[0];

    // ⏰ check expire
    if (lic.expireAt && new Date() > new Date(lic.expireAt)) {
      return res.json({
        userId,
        licensed: false,
        expireAt: lic.expireAt
      });
    }

    res.json({
      userId,
      licensed: true,
      expireAt: lic.expireAt || null
    });

  } catch (err) {
    console.log("ME ERROR:", err);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// =========================
// SEARCH
// =========================
app.get("/api/search", async (req, res) => {
  try {
    const { category } = req.query;
    let q = (req.query.q || "").trim();

    if (!q) return res.json([]);

    const normalized = normalize(q);

    const [rows] = await db.execute(
  `
  SELECT * FROM qa_data
  WHERE (? = '' OR category = ?)
  AND (
    searchText LIKE ?
    OR question LIKE ?
    OR answer LIKE ?
  )
  LIMIT 20
  `,
  [
    category || "",
    category || "",
    `%${normalized}%`,
    `%${normalized}%`,
    `%${normalized}%`
  ]
);

    res.json(rows);

  } catch (err) {
    console.log("SEARCH ERROR:", err);
    res.json([]);
  }
});

// =========================
// SAVE
// =========================
app.post("/api/save", authMiddleware, async (req, res) => {
  try {

    const { question, answer } = req.body;
    const userId = req.user.userId;

    if (!question || !answer)
      return res.json({ success: false, msg: "Thiếu dữ liệu" });

    if (question.length > 200)
      return res.json({ success: false, msg: "Q max 200 ký tự" });

    // 🔥 CHECK LICENSE (search-bot)
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE user_id=? AND valid=1 AND type='searchbot'",
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, msg: "Bạn chưa kích hoạt key" });
    }

    const lic = rows[0];

    if (lic.expireAt && new Date() > new Date(lic.expireAt)) {
      return res.json({ success: false, msg: "Key đã hết hạn" });
    }

    // 🔥 RATE LIMIT
    const rateKey = "save_" + userId;
    if (!checkRate(rateKey)) {
      return res.json({ success: false, msg: "Too many requests" });
    }

    await db.execute(
      "INSERT INTO qa_data (question, answer, searchText, user_id) VALUES (?, ?, ?, ?)",
      [question, answer, normalize(question), userId]
    );

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