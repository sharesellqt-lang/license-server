
"use strict";

const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    timezone: "+07:00"
});

/*
=================================
 TEST CONNECTION
=================================
*/

async function testDB() {
    let conn;

    try {
        conn = await db.getConnection();

        console.log(
            "✅ MYSQL CONNECTED:",
            conn.threadId
        );

    } catch (err) {
        console.error(
            "❌ MYSQL CONNECTION ERROR:",
            err.message
        );

    } finally {
        if (conn) conn.release();
    }
}

testDB();

/*
=================================
 EXPORT
=================================
*/

module.exports = db;
