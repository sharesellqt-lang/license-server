const db = require("../db");

setInterval(async () => {

  console.log("🔄 scanning bank...");

  // giả lập
  const fakeTransactions = [
    { id: "tx1", content: "1 PRO" }
  ];

  for (let tx of fakeTransactions) {

    const [userId, plan] = tx.content.split(" ");

    const exists = await db.query(
      "SELECT * FROM payments WHERE transaction_id=?",
      [tx.id]
    );

    if (exists.length) continue;

    await db.query(
      "UPDATE users SET plan=? WHERE id=?",
      [plan.toLowerCase(), userId]
    );

    await db.query(
      "INSERT INTO payments (user_id, plan, method, status, transaction_id) VALUES (?, ?, 'bank', 'done', ?)",
      [userId, plan, tx.id]
    );
  }

}, 60000);