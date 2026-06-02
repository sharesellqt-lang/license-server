exports.getMatches = async (req, res) => {

  const user_id = req.user.id;

  const [rows] = await db.query(
    `
    SELECT
      m.*,
      p.name,
      p.avatar,
      p.age,
      p.location
    FROM dating_matches m
    JOIN dating_profiles p
      ON (
        (m.user1_id = ? AND p.user_id = m.user2_id)
        OR
        (m.user2_id = ? AND p.user_id = m.user1_id)
      )
    WHERE m.user1_id = ?
       OR m.user2_id = ?
    `,
    [
      user_id,
      user_id,
      user_id,
      user_id
    ]
  );

  res.json(rows);

};