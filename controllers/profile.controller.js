const db = require("../db");

exports.getProfiles = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM dating_profiles LIMIT 50");
  res.json(rows);
};