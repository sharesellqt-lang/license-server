const db = require("../db");
exports.getProfiles = async (req, res) => {

  const user_id = req.user.id;

  const {
    gender,
    minAge,
    maxAge
  } = req.query;

  const [rows] =
    await db.query(
      `
      SELECT *
      FROM dating_profiles

      WHERE user_id != ?

      AND user_id NOT IN (
        SELECT target_id
        FROM dating_swipes
        WHERE user_id = ?
        AND type IN ('like','dislike')
      )

      AND (
        gender = ?
        OR ? = ''
      )

      AND age >= ?
      AND age <= ?

      LIMIT 100
      `,
      [
        user_id,
        user_id,
        gender || "",
        gender || "",
        minAge || 18,
        maxAge || 99
      ]
    );

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
    avatar,
    bio
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      error: "Name required"
    });
  }

  if (!age) {
    return res.status(400).json({
      error: "Age required"
    });
  }

  if (!location?.trim()) {
    return res.status(400).json({
      error: "Location required"
    });
  }

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
      avatar,
      bio
    )
    VALUES
    (
      ?,?,?,?,?,?,?,?,?,?,?
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
      avatar = VALUES(avatar),
      bio = VALUES(bio)
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
      avatar,
      bio
    ]
  );

  res.json({
    success: true
  });

};