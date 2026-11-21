
"use strict";

const mysql = require("mysql2/promise");

const dbHost = process.env.DB_HOST?.trim();

console.log("========== DATABASE CONFIG ==========");
console.log("DB_HOST:", dbHost || "MISSING");
console.log("DB_USER:", process.env.DB_USER ? "SET" : "MISSING");
console.log("DB_NAME:", process.env.DB_NAME ? "SET" : "MISSING");
console.log("DB_PORT:", process.env.DB_PORT || "3306");
console.log("=====================================");

const db = mysql.createPool({
    host: dbHost,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    timezone: "+07:00",
    dateStrings: true
});

// Chỉ kiểm tra khi được gọi chủ động
db.testConnection = async function () {
    let conn;

    try {
        conn = await db.getConnection();

        const [rows] = await conn.query(`
            SELECT
                DATABASE() AS database_name,
                USER() AS db_user,
                CONNECTION_ID() AS connection_id
        `);

        console.log("MYSQL ACTIVE CONNECTION:", rows[0]);
        console.log("✅ MYSQL CONNECTED:", conn.threadId);

        return true;
    } catch (err) {
        console.error("❌ MYSQL CONNECTION ERROR:", err.message);
        return false;
    } finally {
        if (conn) conn.release();
    }
};

module.exports = db;
