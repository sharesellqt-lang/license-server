const db = require("../db");

exports.sendMessage = async (req, res) => {
  const { match_id, message } = req.body;
  const sender_id = req.user.google_id || req.user.id;

  await db.query(
    `INSERT INTO dating_messages (match_id, sender_id, message)
     VALUES (?, ?, ?)`,
    [match_id, sender_id, message]
  );

  res.json({ success: true });
};

exports.getMessages = async (req, res) => {
  const { match_id } = req.params;

  const [rows] = await db.query(
    `SELECT * FROM dating_messages
     WHERE match_id = ?
     ORDER BY created_at ASC`,
    [match_id]
  );

  res.json(rows);
};