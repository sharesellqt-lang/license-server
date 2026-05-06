const fetch = require("node-fetch");

exports.createPaypalOrder = async (req, res) => {

  const { plan } = req.body;
  const userId = req.user.id; // ⚠️ cần middleware auth

  const priceMap = {
    pro: 5,
    vip: 10
  };

  const order = {
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: priceMap[plan]
      },
      custom_id: JSON.stringify({ userId, plan })
    }]
  };

  const response = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer YOUR_ACCESS_TOKEN"
    },
    body: JSON.stringify(order)
  });

  const data = await response.json();

  res.json(data);
};