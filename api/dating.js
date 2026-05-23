const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const db = require("../db");
const auth = require("../middleware/auth");

console.log("🔥 DATING ROUTER LOADED");

/* =========================
   INIT UPLOAD AVATAR
========================= */
const avatarDir = path.join(__dirname, "../uploads/avatars");
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

/* =========================
   GET MY PROFILE
========================= */
router.get("/profile", auth, async (req, res) => {
  try {
    const rows = await db.query(
      "SELECT * FROM dating_profiles WHERE user_id=?",
      [req.user.id]
    );

    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   CREATE / UPDATE PROFILE
========================= */
router.post("/profile", auth, async (req, res) => {
  try {
    const u = req.user.id;
    const d = req.body;

    // 🔥 bắt buộc avatar
    if (!d.avatar) {
      return res.status(400).json({
        success: false,
        message: "Avatar is required"
      });
    }

    const [exist] = await db.query(
      "SELECT id FROM dating_profiles WHERE user_id=?",
      [u]
    );

    if (exist.length > 0) {
      await db.query(
        `UPDATE dating_profiles SET
        name=?, gender=?, age=?, job=?, interests=?,
        seeking_gender=?, intent=?, location=?, avatar=?
        WHERE user_id=?`,
        [
          d.name,
          d.gender,
          d.age,
          d.job,
          d.interests,
          d.seeking_gender,
          d.intent,
          d.location,
          d.avatar,
          u
        ]
      );
    } else {
      await db.query(
        `INSERT INTO dating_profiles
        (user_id,name,gender,age,job,interests,seeking_gender,intent,location,avatar)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          u,
          d.name,
          d.gender,
          d.age,
          d.job,
          d.interests,
          d.seeking_gender,
          d.intent,
          d.location,
          d.avatar
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   UPLOAD AVATAR
========================= */
router.post(
  "/upload-avatar",
  auth,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false });
      }

      res.json({
        success: true,
        avatar: `/uploads/avatars/${req.file.filename}`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================
   SEARCH PROFILES
========================= */
router.post("/search", async (req, res) => {
  try {
    let sql = "SELECT * FROM dating_profiles WHERE 1=1";
    let p = [];

    if (req.body.gender) {
      sql += " AND gender=?";
      p.push(req.body.gender);
    }

    if (req.body.age) {
      sql += " AND age=?";
      p.push(req.body.age);
    }

    if (req.body.job) {
      sql += " AND job LIKE ?";
      p.push("%" + req.body.job + "%");
    }

    if (req.body.location) {
      sql += " AND location LIKE ?";
      p.push("%" + req.body.location + "%");
    }

    if (req.body.interest) {
      sql += " AND interests LIKE ?";
      p.push("%" + req.body.interest + "%");
    }

    const rows = await db.query(sql, p);

    console.log("SEARCH RESULT:", rows.length);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

/* =========================
   FOLLOW SYSTEM
========================= */
router.post("/follow", auth, async (req, res) => {
  try {
    await db.query(
      "INSERT IGNORE INTO dating_follow (follower_id,following_id) VALUES (?,?)",
      [req.user.id, req.body.followingId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.post("/unfollow", auth, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM dating_follow WHERE follower_id=? AND following_id=?",
      [req.user.id, req.body.followingId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* =========================
   PUBLIC CHAT
========================= */
router.get("/chat", async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT c.message, u.name
      FROM dating_chat c
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.id DESC
      LIMIT 50
    `);

    res.json(rows.reverse());
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

router.post("/chat", auth, async (req, res) => {
  try {
    await db.query(
      "INSERT INTO dating_chat (user_id,message) VALUES (?,?)",
      [req.user.id, req.body.message]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* =========================
   PRIVATE MESSAGE
========================= */
router.post("/message", auth, async (req, res) => {
  try {
    await db.query(
      "INSERT INTO dating_messages (sender_id,receiver_id,message) VALUES (?,?,?)",
      [req.user.id, req.body.receiver_id, req.body.message]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/messages/:id", auth, async (req, res) => {
  try {
    const me = req.user.id;
    const other = req.params.id;

    const rows = await db.query(
      `SELECT * FROM dating_messages
       WHERE (sender_id=? AND receiver_id=?)
       OR (sender_id=? AND receiver_id=?)`,
      [me, other, other, me]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

module.exports = router;