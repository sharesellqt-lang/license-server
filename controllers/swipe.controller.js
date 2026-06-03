const db = require("../db");

// swipe user
exports.swipe = async (req, res) => {
  const { target_id, type } = req.body;
  const user_id = req.user.id;

  await db.query(
    "INSERT INTO dating_swipes (user_id, target_id, type) VALUES (?, ?, ?)",
    [user_id, target_id, type]
  );

  // nếu dislike thì dừng
  if (type === "dislike") {
    return res.json({ match: false });
  }

  // check mutual like
  const [rows] = await db.query(
    `SELECT * FROM dating_swipes 
     WHERE user_id = ? AND target_id = ? AND type = 'like'`,
    [target_id, user_id]
  );

  if (rows.length > 0) {
    // create match
    await db.query(
      `INSERT IGNORE INTO dating_matches (user1_id, user2_id)
       VALUES (?, ?)`,
      [user_id, target_id]
    );

    return res.json({ match: true });
  }

  res.json({ match: false });
};

exports.getLikedUsers = async (req, res) => {

  const userId = req.user.id;

  const [rows] = await db.query(
    `
    SELECT target_id
    FROM dating_swipes
    WHERE user_id = ?
    AND type = 'like'
    `,
    [userId]
  );

  res.json(rows);

};

exports.unlikeUser = async (req, res) => {

  await db.query(
    `
    DELETE FROM dating_swipes
    WHERE user_id = ?
    AND target_id = ?
    AND type = 'like'
    `,
    [
      req.user.id,
      req.params.id
    ]
  );

  res.json({
    success: true
  });

};