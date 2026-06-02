const db = require("../db");

exports.addComment = async (req, res) => {
  const { profile_id, comment } = req.body;
  const user_id = req.user.id;

  await db.query(
    `INSERT INTO dating_comments (profile_id, user_id, comment)
     VALUES (?, ?, ?)`,
    [profile_id, user_id, comment]
  );

  res.json({ success: true });
};

exports.getComments = async (req, res) => {

  const { profile_id } = req.params;

  const [rows] = await db.query(
    `
    SELECT *
    FROM dating_comments
    WHERE profile_id = ?
    ORDER BY created_at DESC
    `,
    [profile_id]
  );

  res.json(rows);

};