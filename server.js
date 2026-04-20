const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// fake DB (sau nâng MongoDB)
let licenses = {
  "ABC-123": {
    valid: true,
    deviceId: null,
    lastActive: null
  }
};

// verify license
app.get("/verify", (req, res) => {

  const { key, deviceId } = req.query;

  const lic = licenses[key];

  if (!lic || !lic.valid) {
    return res.json({ valid: false });
  }

  // CHỐNG SHARE DEVICE
  if (lic.deviceId && lic.deviceId !== deviceId) {
    return res.json({ valid: false, reason: "DEVICE_LOCKED" });
  }

  // bind device lần đầu
  if (!lic.deviceId) {
    lic.deviceId = deviceId;
  }

  lic.lastActive = Date.now();

  return res.json({
    valid: true
  });
});

// revoke realtime
app.post("/revoke", (req, res) => {
  const { key } = req.body;

  if (licenses[key]) {
    licenses[key].valid = false;
  }

  res.json({ success: true });
});

app.listen(3000, () => {
  console.log("License server running...");
});
