const db = require("../db");

exports.getMatches = async (req, res) => {
  const user_id = req.user.google_id || req.user.id;

  const [rows] = await db.query(
    `SELECT * FROM dating_matches
     WHERE user1_id = ? OR user2_id = ?`,
    [user_id, user_id]
  );

  res.json(rows);
};