// File: src/api/dating.js
console.log("🔥 dating router LOADED");
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const authMiddleware = require('../middleware/auth');


// ================== UPLOAD AVATAR ==================
const avatarDir = path.join(__dirname, '../uploads/avatars');
if(!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

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
  authMiddleware,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file" });
      }

    return res.json({
    success: true,
    avatar: `/uploads/avatars/${req.file.filename}`
  });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// ... Phần save profile, search, follow/comment giữ nguyên

// ================== SAVE PROFILE ==================
router.post('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, gender, age, job, interests, seeking_gender, intent, location, avatar } = req.body;
    const user_id = req.user.id;

    const [existing] = await db.query('SELECT * FROM dating_profiles WHERE user_id=?', [user_id]);
    if (existing.length > 0) {
      await db.query(
        `UPDATE dating_profiles SET name=?, gender=?, age=?, job=?, interests=?, seeking_gender=?, intent=?, location=?, avatar=? WHERE user_id=?`,
        [name, gender, age, job, interests, seeking_gender, intent, location, avatar, user_id]
      );
    } else {
      await db.query(
        `INSERT INTO dating_profiles (user_id,name,gender,age,job,interests,seeking_gender,intent,location,avatar) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [user_id, name, gender, age, job, interests, seeking_gender, intent, location, avatar]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ================== SEARCH ==================
router.post('/search', async (req, res) => {
  try {
    const { gender, age, job, location, interest, intent } = req.body;
    let sql = 'SELECT * FROM dating_profiles WHERE 1';
    let params = [];

    if (gender) { sql += ' AND gender=?'; params.push(gender); }
    if (age) { sql += ' AND age=?'; params.push(age); }
    if (job) { sql += ' AND job LIKE ?'; params.push(`%${job}%`); }
    if (location) { sql += ' AND location LIKE ?'; params.push(`%${location}%`); }
    if (interest) { sql += ' AND interests LIKE ?'; params.push(`%${interest}%`); }
    if (intent) { sql += ' AND intent=?'; params.push(intent); }

    const [rows] = await db.query(sql, params);
// 👇 ĐẶT Ở ĐÂY
    console.log("SEARCH RESULT:", rows.length);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// ================== FOLLOW / UNFOLLOW ==================
router.post('/follow', authMiddleware, async (req, res) => {
  try {
    const follower_id = req.user.id;
    const following_id = req.body.followingId;
    await db.query('INSERT IGNORE INTO dating_follow (follower_id,following_id) VALUES (?,?)', [follower_id, following_id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.post('/unfollow', authMiddleware, async (req, res) => {
  try {
    const follower_id = req.user.id;
    const following_id = req.body.followingId;
    await db.query('DELETE FROM dating_follow WHERE follower_id=? AND following_id=?', [follower_id, following_id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

// ================== COMMENTS ==================
router.get('/comments/:profileId', authMiddleware, async (req, res) => {
  try {
    const profileId = req.params.profileId;
    const rows = await db.query(
      `SELECT c.comment, u.name as userName FROM dating_comments c 
       JOIN users u ON c.user_id=u.id 
       WHERE c.profile_id=? ORDER BY c.id ASC`,
      [profileId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

router.post('/comment', authMiddleware, async (req, res) => {
  try {
    const { profileId, comment } = req.body;
    const user_id = req.user.id;
    await db.query('INSERT INTO dating_comments (profile_id,user_id,comment) VALUES (?,?,?)', [profileId, user_id, comment]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

module.exports = router;