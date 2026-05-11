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

  // 1. find payment FIRST
  const [rows] = await db.query(
    "SELECT * FROM payments WHERE content = ? AND status = 'pending'",
    [tx.content]
  );

  if (!rows.length) {
    console.log("❌ payment not found:", tx.content);
    continue;
  }

  const payment = rows[0];

  // 2. duplicate check
  const [dup] = await db.query(
    "SELECT id FROM payments WHERE transaction_id = ?",
    [tx.id]
  );

  if (dup.length) {
    console.log("⚠ duplicate tx");
    continue;
  }

  // 3. update payment
  await db.query(
    `UPDATE payments 
     SET status='paid', transaction_id=?, paid_at=NOW() 
     WHERE id=?`,
    [tx.id, payment.id]
  );

  // 4. update user
  await db.query(
    "UPDATE users SET plan=? WHERE id=?",
    [payment.plan, payment.user_id]
  );

  console.log("✅ payment success:", payment.id);
}
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