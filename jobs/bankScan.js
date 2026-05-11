const db = require("../db");

setInterval(async () => {

  console.log("🔄 scanning bank...");

  // giả lập
  const fakeTransactions = [
    {
      id: "tx1",
      content: "USER1P33"
    }
  ];

  for (const tx of fakeTransactions) {

    // =================================================
    // PARSE CONTENT
    // =================================================

    const match = tx.content.match(/^USER(\d+)P(\d+)$/);

    if (!match) {
      console.log("❌ invalid content:", tx.content);
      continue;
    }

    const userId = Number(match[1]);
    const paymentId = Number(match[2]);

    // =================================================
    // FIND PAYMENT
    // =================================================

    const [rows] = await db.query(
  "SELECT * FROM payments WHERE content = ? AND status='pending'",
  [tx.content]

);

if (!rows.length) {
  console.log("❌ payment not found");
  continue;
}

const payment = rows[0];

await db.query(
  "UPDATE payments SET status='paid', transaction_id=? WHERE id=?",
  [tx.id, payment.id]
);

    // =================================================
    // DUPLICATE CHECK
    // =================================================

    const [dup] = await db.query(`
      SELECT id
      FROM payments
      WHERE transaction_id = ?
      LIMIT 1
    `, [tx.id]);

    if (dup.length) {
      console.log("⚠ duplicate tx");
      continue;
    }

    // =================================================
    // UPDATE USER
    // =================================================

    await db.query(`
      UPDATE users
      SET plan = ?
      WHERE id = ?
    `, [
      payment.plan,
      userId
    ]);

    // =================================================
    // UPDATE PAYMENT
    // =================================================

    await db.query(`
      UPDATE payments
      SET status = 'paid',
          transaction_id = ?,
          paid_at = NOW()
      WHERE id = ?
    `, [
      tx.id,
      paymentId
    ]);

    console.log("✅ payment success:", paymentId);
  }

}, 60000);