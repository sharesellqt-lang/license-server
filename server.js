require("dotenv").config();

// =========================
// IMPORT CORE
// =========================
const express = require("express");
const cors = require("cors");
const db = require("./db"); // 👈 PHẢI Ở ĐÂY
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = express();

app.use((req,res,next)=>{
  console.log("HIT:",req.method,req.originalUrl);
  next();
});

// =========================
// CORS CONFIG (CHUẨN 1 LỚP DUY NHẤT)
// =========================
const corsOptions = {
  origin: [
    "https://sharesell.net",
    "https://www.sharesell.net"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// =========================
// DEBUG LOG (OPTIONAL)
// =========================
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl);
  next();
});

// =========================
// BODY PARSER
// =========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// STATIC FILES
// =========================
app.use("/assets", express.static("assets"));
app.use("/api/avatar", require("./routes/avatar.routes"));

// =========================
// ROUTES (CORE DATING)
// =========================
app.use("/api/profile", require("./routes/profile.routes"));
app.use("/api/swipe", require("./routes/swipe.routes"));
app.use("/api/match", require("./routes/match.routes"));
app.use("/api/message", require("./routes/message.routes"));
app.use("/api/follow", require("./routes/follow.routes"));
app.use("/api/comment", require("./routes/comment.routes"));

// =========================
// PAYMENT / USER SYSTEM
// =========================
app.use("/api", require("./routes/paymentHistory"));
app.use("/api", require("./routes/payment"));
app.use("/api", require("./routes/paymentStatus"));
app.use("/api", require("./routes/uploadBill"));
app.use("/api", require("./routes/user"));
app.use("/api", require("./routes/upgrade"));
app.use("/api", require("./routes/webhook"));
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/plans"));
app.use("/api", require("./routes/feature.routes"));
app.use("/api", require("./routes/usage"));
app.use("/api/admin", require("./routes/admin"));

// =========================
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("Dating Hub API running...");
});

console.log("🔥 DATING ROUTE MOUNTED");

// =========================
// CONFIG
// =========================
const PORT = process.env.PORT || 10000;

require("dotenv").config();
console.log("ENV TEST:", {
  BANK_NAME: process.env.BANK_NAME,
  BANK_ACCOUNT: process.env.BANK_ACCOUNT,
  BANK_OWNER: process.env.BANK_OWNER
});

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


app.use(express.json());
const OpenAI = require("openai");

let openai = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// 🔥 LOGIN TEST (tạo token luôn)
app.post("/api/login", (req, res) => {

  // giả lập user
  const user = {
    id: 1,
    plan: "pro"
  };

  const token = jwt.sign(user, process.env.JWT_SECRET);

  res.json({ token });

});


app.post("/api/image", async (req, res) => {

  try {

    if (!openai) {
      return res.status(500).json({
        error: "OPENAI_API_KEY missing"
      });
    }

    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt required"
      });
    }

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });
  }

});

app.post("/api/video", async (req, res) => {

  if (!openai) {
    return res.status(500).json({
      error: "OPENAI_API_KEY missing"
    });
  }

  return res.status(501).json({
    error: "Video generation not implemented yet"
  });

});

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

   // 🔥 BLOCK SPAM CHECK (1 block duy nhất)
    const emailLower = email.toLowerCase();

    const blockedKeywords = [
      "blogspot",
      "btc",
      "binance",
      "mining"
    ];

    const domain = emailLower.split("@")[1];

    const blockedDomains = [
      "blogspot.com",
      "blogspot.cz",
      "blogspot.de",
      "blogspot.dk"
    ];

    if (
      blockedKeywords.some(k => emailLower.includes(k)) ||
      blockedDomains.includes(domain)
    ) {
      return res.status(403).json({
        error: "BLOCKED_EMAIL"
      });
    }

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

// chạy cron bank
require("./jobs/bankScan");


// =========================
// REDEEM KEY (FIX SAFE - PLAN INTEGRATION)
// =========================
app.post("/redeem", authMiddleware, async (req, res) => {
  try {

    const { key } = req.body;
    const userId = req.user.id;

    if (!key) {
      return res.json({ success: false, msg: "MISSING_KEY" });
    }

    // 🔍 tìm key
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE `key`=?",
      [key]
    );

    if (rows.length === 0) {
      return res.json({ success: false, msg: "INVALID_KEY" });
    }

    const lic = rows[0];

    // ❌ KEY đã dùng
    if (lic.user_id) {
      return res.json({ success: false, msg: "KEY_USED" });
    }

    // =========================
    // 🔥 APPLY PLAN (KHÔNG HARD CODE)
    // =========================
    const planToApply = lic.plan || "pro";

    await db.execute(
      "UPDATE users SET plan=? WHERE id=?",
      [planToApply, userId]
    );

    // 🔒 mark key used
    await db.execute(
      "UPDATE licenses SET user_id=? WHERE id=?",
      [userId, lic.id]
    );

    res.json({ success: true });

  } catch (err) {
    console.log("REDEEM ERROR:", err);
    res.json({ success: false, msg: "SERVER_ERROR" });
  }
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

    console.log("VERIFY ERROR:", err);

    res.json({
      valid: false,
      msg: err.message || "Server lỗi"
    });

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
console.log("=== REQUEST START ===");
console.log(req.url);
console.log(req.query);
console.log(req.user);
    console.log("🔥 SECURE POST HIT");
    console.log("QUERY:", req.query);
    console.log("USER:", req.user);
    const { postId } = req.query;

    if (!postId) {
      return res.json({ error: "MISSING" });
    }

    const userId = req.user.id;

   // 🔥 CHECK USER PLAN MỚI
    const [rows] = await db.execute(
      "SELECT plan, expire_at FROM users WHERE id=? LIMIT 1",
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ error: "NO_LICENSE" });
    }

    const user = rows[0];

    // FREE = không có quyền
    if (!user.plan || user.plan === "free") {
      return res.json({ error: "NO_LICENSE" });
    }

    // hết hạn
    if (
      user.expire_at &&
      new Date() > new Date(user.expire_at)
    ) {
      return res.json({ error: "EXPIRED" });
    }

    const wpRes = await fetch(`${WP_API}/${postId}`);
console.log("🌐 CALL WP:", `${WP_API}/${postId}`);

    if (!wpRes.ok) {
      return res.json({ error: "WP_FAIL" });
    }

    const post = await wpRes.json();

    // 🔥 FIX CHỐT: chống undefined crash
    const rawContent =
      post?.content?.rendered || "";

    if (!rawContent) {
      return res.json({ error: "EMPTY_CONTENT" });
    }

    let content = addWatermark(rawContent, userId);

    content = encodeContent(content);

    return res.json({
      title: post?.title?.rendered || "No title",
      content
    });

  } catch (err) {
  console.error("❌ SECURE POST ERROR FULL:");
  console.error(err);
  console.error(err?.stack);
console.error("🔥 RAW ERROR:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
  return res.json({ error: "SERVER_ERROR" });
}
});

// =========================
// ME (USER INFO)
// =========================
app.get("/me", authMiddleware, async (req, res) => {

  try {

    const [rows] = await db.execute(
      `
      SELECT 
        id,
        plan,
	cycle,
        created_at,
        expire_at
      FROM users
      WHERE id=?
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows.length) {

      return res.status(404).json({
        error: "USER_NOT_FOUND"
      });
    }

    const user = rows[0];

    // 🔥 FREE nếu hết hạn
    let plan = String(user.plan || "free").trim().toLowerCase();

    if (
      user.expire_at &&
      new Date() > new Date(user.expire_at)
    ) {
      plan = "free";
    }

const now = new Date();

const expireAt =
  user.expire_at
    ? new Date(user.expire_at)
    : null;

const isActive =
  expireAt && expireAt > now;

const daysLeft =
  expireAt
    ? Math.max(
        0,
        Math.ceil(
          (expireAt - now)
          / (1000 * 60 * 60 * 24)
        )
      )
    : 0;

    return res.json({

  id: user.id,

  licensed:
    plan !== "free",

  isActive,

  daysLeft,

  plan,

  cycle:
    user.cycle || "month",

  expireAt:
    user.expire_at || null

});

  } catch (err) {

    console.log("ME ERROR:", err);

    res.status(500).json({
      error: "SERVER_ERROR"
    });
  }
});
// =========================
// CHECK (LIMIT)
// =========================
app.post("/check-limit", authMiddleware, async (req, res) => {
  try {

    const userId = req.user.id || req.user.id;
    const { tool } = req.body;

    // 🔥 lấy plan
    const [rows] = await db.execute(
      `SELECT plan FROM licenses 
       WHERE user_id=? AND valid=1 
       ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    const plan = rows.length ? (rows[0].plan || "free") : "free";

    // 🔥 định mức
    const limits = {
      free: 5,
      pro: 100,
      vip: 999999
    };

    const limit = limits[plan] || 5;

    // 🔥 đếm số lần hôm nay
    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total 
       FROM tool_usage 
       WHERE user_id=? 
       AND DATE(created_at) = CURDATE()`,
      [userId]
    );

    const used = countRows[0].total;

    if (used >= limit) {
      return res.json({
        allowed: false,
        used,
        limit,
        plan
      });
    }

    res.json({
      allowed: true,
      used,
      limit,
      plan
    });

  } catch (err) {
    console.log("LIMIT ERROR:", err);
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

    const question = req.body.question || req.body.q;
    const answer = req.body.answer || req.body.a;
    const userId = req.user.id;

    if (!question || !answer)
      return res.json({ success: false, msg: "Thiếu dữ liệu" });

    if (question.length > 200)
      return res.json({ success: false, msg: "Q max 200 ký tự" });

    // 🔥 CHECK USER (FIX: bỏ expireAt vì DB không có)
    const [userRows] = await db.execute(
      "SELECT plan FROM users WHERE id=?",
      [userId]
    );

    const user = userRows[0];

    if (!user) {
      return res.json({ success: false, msg: "User không tồn tại" });
    }

    // 🔥 PLAN CHECK (giữ nguyên logic)
    const plan = user.plan;

    if (!plan || plan === "free") {
      return res.json({ success: false, msg: "Bạn chưa nâng cấp plan" });
    }

    // ❌ REMOVED: expireAt check (gây crash vì DB không có cột này)

    // =========================
    // ✅ SAVE
    // =========================
    const normalized = normalize(question);

    await db.execute(
      `INSERT INTO qa_data 
       (question, answer, searchText, user_id, user_plan)
       VALUES (?, ?, ?, ?, ?)`,
      [
        question ?? null,
        answer ?? null,
        normalized,
        userId ?? null,
        user.plan ?? null
      ]
    );

    res.json({ success: true });

  } catch (err) {

    console.log("SAVE ERROR:", err);

    res.json({
      success: false,
      msg: err.message || "Lỗi server"
    });

  }
});
// ===============================
// 🔥 TOOL SYSTEM - LOG USER USAGE
// thêm dưới /api/save để dễ quản lý
// ===============================
app.post("/api/log-tool", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tool } = req.body;

    await db.execute(
      "INSERT INTO tool_logs (user_id, tool, created_at) VALUES (?, ?, NOW())",
      [userId, tool]
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