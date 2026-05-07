const express = require("express");
const router = express.Router();
const License = require("./models/License");

/* =========================
   ADMIN AUTH MIDDLEWARE
========================= */
function adminAuth(req, res, next) {
  const { token } = req.headers;

  if (token !== "admin-token") {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  next();
}

/* =========================
   LOGIN ADMIN
========================= */
const ADMIN_USER = "admin";
const ADMIN_PASS = "123456";

router.post("/login", (req, res) => {
  const { user, pass } = req.body;

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return res.json({ success: true, token: "admin-token" });
  }

  return res.json({ success: false });
});

/* =========================
   LIST LICENSES
========================= */
router.get("/licenses", adminAuth, async (req, res) => {
  const list = await License.find();
  res.json(list);
});

/* =========================
   CREATE LICENSE
========================= */
router.post("/create", adminAuth, async (req, res) => {
  const { key } = req.body;

  const exist = await License.findOne({ key });
  if (exist) return res.json({ error: "EXISTS" });

  const license = new License({
    key,
    valid: true,
    devices: [],
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  await license.save();

  res.json({ success: true });
});

/* =========================
   RESET DEVICE
========================= */
router.post("/reset-device", adminAuth, async (req, res) => {
  const { key } = req.body;

  await License.updateOne(
    { key },
    { $set: { devices: [] } }
  );

  res.json({ success: true });
});

/* =========================
   REVOKE KEY
========================= */
router.post("/revoke", adminAuth, async (req, res) => {
  const { key } = req.body;

  await License.updateOne(
    { key },
    { valid: false }
  );

  res.json({ success: true });
});

module.exports = router;