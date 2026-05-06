const db = require("../db"); // 🔥 dùng lại db.js của bạn

async function getUserById(id) {
  try {
    const [rows] = await db.query(
      "SELECT id, plan, expireAt FROM users WHERE id = ?",
      [id]
    );

    return rows[0] || null;

  } catch (err) {
    console.log("DB ERROR:", err);
    return null;
  }
}

module.exports = {
  getUserById
};