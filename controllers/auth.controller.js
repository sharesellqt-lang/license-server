const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { email, google_id } = req.body;

  const token = jwt.sign(
    { email, google_id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
};