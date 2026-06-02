const db = require("../db");

exports.follow = async (req, res) => {
  const user_id = req.user.google_id || req.user.id;
  const { target_id } = req.body;

  await db.query(
    `INSERT IGNORE INTO dating_follow (follower_id, following_id)
     VALUES (?, ?)`,
    [user_id, target_id]
  );

  res.json({ success: true });
};