const db = require("../db");

// swipe user
exports.swipe = async (req, res) => {

  const { target_id, type } = req.body;
  const user_id = req.user.id;

  // 1. lưu swipe (LIKE hoặc DISLIKE)
  await db.query(
    `INSERT INTO dating_swipes (user_id, target_id, type)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE type = VALUES(type)`,
    [user_id, target_id, type]
  );

  // 2. nếu dislike → dừng luôn
  if (type === "dislike") {
    return res.json({ match: false });
  }

  // 3. check mutual like
  const [rows] = await db.query(
    `SELECT *
     FROM dating_swipes
     WHERE user_id = ? AND target_id = ? AND type = 'like'`,
    [target_id, user_id]
  );

  if (rows.length > 0) {

    await db.query(
      `INSERT IGNORE INTO dating_matches (user1_id, user2_id)
       VALUES (?, ?)`,
      [user_id, target_id]
    );

    return res.json({ match: true });
  }

  return res.json({ match: false });
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

exports.undoDislike = async (req, res) => {

  await db.query(
    `
    DELETE FROM dating_swipes
    WHERE user_id = ?
    AND target_id = ?
    AND type = 'dislike'
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

exports.getDislikedUsers = async (req, res) => {

  const userId = req.user.id;

  const [rows] = await db.query(
    `
    SELECT
      ds.target_id,
      dp.name,
      dp.avatar,
      dp.age,
      dp.location
    FROM dating_swipes ds

    LEFT JOIN dating_profiles dp
      ON dp.user_id = ds.target_id

    WHERE ds.user_id = ?
    AND ds.type = 'dislike'
    GROUP BY ds.target_id
    `,
    [userId]
  );

  res.json(rows);

};