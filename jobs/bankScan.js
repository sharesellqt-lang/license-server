const db = require("../db");

// =====================================================
// BANK SCANNER (FAKE / DEMO VERSION)
// =====================================================

setInterval(async () => {

  try {

    console.log("🔄 scanning bank...");

    // =================================================
    // FAKE TRANSACTIONS (DEMO ONLY)
    // =================================================

    const fakeTransactions = [
      {
        id: "tx1",
        content: "USER_1_38" // phải khớp với payment.content
      }
    ];

    // =================================================
    // PROCESS EACH TRANSACTION
    // =================================================

    for (const tx of fakeTransactions) {

      // =========================
      // CHECK VALID CONTENT
      // =========================

      if (!tx.content) {
        console.log("❌ empty content");
        continue;
      }

      // =========================
      // FIND PAYMENT
      // =========================

      const [rows] = await db.query(
        "SELECT * FROM payments WHERE content = ? AND status = 'pending'",
        [tx.content]
      );

      if (!rows.length) {
        console.log("❌ payment not found:", tx.content);
        continue;
      }

      const payment = rows[0];

      // =========================
      // CHECK DUPLICATE TRANSACTION
      // =========================

      const [dup] = await db.query(
        "SELECT id FROM payments WHERE transaction_id = ?",
        [tx.id]
      );

      if (dup.length) {
        console.log("⚠ duplicate transaction:", tx.id);
        continue;
      }

      // =========================
      // UPDATE PAYMENT
      // =========================

      await db.query(
        `UPDATE payments 
         SET status = 'paid',
             transaction_id = ?,
             paid_at = NOW()
         WHERE id = ?`,
        [tx.id, payment.id]
      );

      // =========================
      // UPDATE USER PLAN
      // =========================

      await db.query(
        "UPDATE users SET plan = ? WHERE id = ?",
        [payment.plan, payment.user_id]
      );

      console.log("✅ payment success:", payment.id);
    }

  } catch (err) {
    console.error("❌ BANK SCAN ERROR:", err);
  }

}, 60000);