const db = require("../db");

exports.follow = async (req, res) => {
  const user_id = req.user.id;
  const { target_id } = req.body;

  await db.query(
    `INSERT IGNORE INTO dating_follow (follower_id, following_id)
     VALUES (?, ?)`,
    [user_id, target_id]
  );

  res.json({ success: true });
};

exports.getFollowers = async (req, res) => {

  const { user_id } = req.params;

  const [rows] = await db.query(
    `
    SELECT *
    FROM dating_follow
    WHERE following_id = ?
    `,
    [user_id]
  );

  res.json(rows);

};

exports.unfollowUser = async (req, res) => {

  await db.query(
    `
    DELETE FROM dating_follow
    WHERE follower_id = ?
    AND following_id = ?
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