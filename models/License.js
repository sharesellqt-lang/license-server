const mongoose = require("mongoose");

const LicenseSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true }
  valid: { type: Boolean, default: true },
  devices: { type: [String], default: [] },
  expireAt: Date,
  userId: mongoose.Schema.Types.ObjectId
});

module.exports = mongoose.model("License", LicenseSchema);