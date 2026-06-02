const db = require("../db");

exports.getProfiles = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM dating_profiles LIMIT 50");
  res.json(rows);
};

// =========================
// GET MY PROFILE
// =========================
exports.getMyProfile = async (req, res) => {

  const user_id = req.user.id;

  const [rows] = await db.query(
    `
    SELECT *
    FROM dating_profiles
    WHERE user_id = ?
    LIMIT 1
    `,
    [user_id]
  );

  if (!rows.length) {
    return res.json(null);
  }

  res.json(rows[0]);

};

// =========================
// SAVE PROFILE
// =========================
exports.saveProfile = async (req, res) => {

  const user_id = req.user.id;

  const {
    name,
    gender,
    age,
    job,
    interests,
    seeking_gender,
    intent,
    location,
    avatar
  } = req.body;

  await db.query(
    `
    INSERT INTO dating_profiles
    (
      user_id,
      name,
      gender,
      age,
      job,
      interests,
      seeking_gender,
      intent,
      location,
      avatar
    )
    VALUES
    (
      ?,?,?,?,?,?,?,?,?,?
    )
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      gender = VALUES(gender),
      age = VALUES(age),
      job = VALUES(job),
      interests = VALUES(interests),
      seeking_gender = VALUES(seeking_gender),
      intent = VALUES(intent),
      location = VALUES(location),
      avatar = VALUES(avatar)
    `,
    [
      user_id,
      name,
      gender,
      age,
      job,
      interests,
      seeking_gender,
      intent,
      location,
      avatar
    ]
  );

  res.json({
    success: true
  });

};