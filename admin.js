const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

/* =========================
   LICENSE MODEL (IMPORT LẠI)
========================= */
const License = mongoose.model("License");

/* =========================
   SIMPLE ADMIN AUTH (TEMP)
========================= */
const ADMIN_USER = "admin";
const ADMIN_PASS = "123456";

/* =========================
   LOGIN ADMIN
========================= */
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
router.get("/licenses", async (req, res) => {
  const list = await License.find();
  res.json(list);
});

/* =========================
   CREATE LICENSE
========================= */
router.post("/create", async (req, res) => {
  const { key } = req.body;

  const exist = await License.findOne({ key });
  if (exist) return res.json({ error: "EXISTS" });

  const license = new License({
    key,
    valid: true,
    devices: [],
    expireAt: new Date(Date.now() + 30*24*60*60*1000)
  });

  await license.save();

  res.json({ success: true });
});

/* =========================
   RESET DEVICE
========================= */
router.post("/reset-device", async (req, res) => {
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
router.post("/revoke", async (req, res) => {
  const { key } = req.body;

  await License.updateOne(
    { key },
    { valid: false }
  );

  res.json({ success: true });
});

module.exports = router;