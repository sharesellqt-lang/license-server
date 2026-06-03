console.log("🔥 DATING ROUTER LOADED");

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const db = require("../db");
const auth = require("../middleware/auth");


// =============================
// UPLOAD AVATAR
// =============================
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


// =============================
// GET PROFILE (MY PROFILE)
// =============================
router.get("/profile", auth, async (req, res) => {
  try {
    const rows = await db.query(
      "SELECT * FROM dating_profiles WHERE user_id=?",
      [req.user.id]
    );

    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json(null);
  }
});


// =============================
// CREATE / UPDATE PROFILE
// =============================
router.post("/profile", auth, async (req, res) => {
  try {
    const u = req.user.id;
    const d = req.body;

    if (!d.avatar) {
      return res.status(400).json({
        success: false,
        message: "Avatar required"
      });
    }

    const exist = await db.query(
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
          d.name, d.gender, d.age, d.job, d.interests,
          d.seeking_gender, d.intent, d.location, d.avatar,
          u
        ]
      );
    } else {
      await db.query(
        `INSERT INTO dating_profiles
        (user_id,name,gender,age,job,interests,seeking_gender,intent,location,avatar)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          u, d.name, d.gender, d.age, d.job, d.interests,
          d.seeking_gender, d.intent, d.location, d.avatar
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


// =============================
// SEARCH PROFILES
// =============================
router.post("/search", async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT 
        id, user_id, name, gender, age,
        job, interests, seeking_gender,
        intent, location, avatar, created_at
      FROM dating_profiles
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});


// =============================
// FOLLOW
// =============================
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


// =============================
// CHECK CAN CHAT (MUST FOLLOW BOTH WAYS)
// =============================
router.get("/can-chat/:id", auth, async (req, res) => {
  try {
    const me = req.user.id;
    const other = req.params.id;

    const rows = await db.query(
      `SELECT 1 FROM dating_follow
       WHERE follower_id=? AND following_id=?`,
      [me, other]
    );

    res.json({ canChat: rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.json({ canChat: false });
  }
});


// =============================
// PUBLIC CHAT
// =============================
router.get("/chat", async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT user_id, message, created_at
      FROM dating_chat
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json(rows.reverse());
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});


// =============================
// SEND PRIVATE MESSAGE
// =============================
router.post("/message", auth, async (req, res) => {
  try {
    const { receiver_id, message } = req.body;

    await db.query(
      `INSERT INTO dating_messages
      (sender_id,receiver_id,message)
      VALUES (?,?,?)`,
      [req.user.id, receiver_id, message]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

module.exports = router;