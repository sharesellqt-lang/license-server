const db = require("../db");

exports.addComment = async (req, res) => {
  const { profile_id, comment } = req.body;
  const user_id = req.user.google_id || req.user.id;

  await db.query(
    `INSERT INTO dating_comments (profile_id, user_id, comment)
     VALUES (?, ?, ?)`,
    [profile_id, user_id, comment]
  );

  res.json({ success: true });
};