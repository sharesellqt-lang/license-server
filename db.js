// db.js
const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: "onehost-amdcloudhn022602.000nethost.com",
  user: "igoiiqkjhosting_bot-license",
  password: "Kythuattoancau@179",
  database: "igoiiqkjhosting_bot-license"

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = db;
