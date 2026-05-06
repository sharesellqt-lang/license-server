const express = require("express");
const router = express.Router();

const { createPaypalOrder } = require("../services/paypal");

// tạo payment
router.post("/paypal/create", createPaypalOrder);

// webhook
router.post("/paypal/webhook", async (req, res) => {

  const event = req.body;

  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {

    const purchase = event.resource.purchase_units[0];
    const meta = JSON.parse(purchase.custom_id);

    const { userId, plan } = meta;

    await db.query("UPDATE users SET plan=? WHERE id=?", [plan, userId]);

    await db.query(
      "INSERT INTO payments (user_id, plan, method, status) VALUES (?, ?, 'paypal', 'done')",
      [userId, plan]
    );
  }

  res.sendStatus(200);
});

module.exports = router;