const db = require("../db");

// =========================
// GET LIKED USERS
// =========================
exports.getLikedUsers = async (req, res) => {

  const userId = req.user.id;

  const [rows] = await db.query(
    `
    SELECT target_id
    FROM dating_swipes
    WHERE user_id = ? AND type = 'like'
    `,
    [userId]
  );

  res.json(rows);
};

// =========================
// GET FOLLOWING USERS
// =========================
exports.getFollowingUsers = async (req, res) => {

  const userId = req.user.id;

  const [rows] = await db.query(
    `
    SELECT following_id
    FROM dating_follow
    WHERE follower_id = ?
    `,
    [userId]
  );

  res.json(rows);
};