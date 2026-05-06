// db.js
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "onehost-amdcloudhn022602.000nethost.com",
  user: "igoiiqkjhosting_bot-license",
  password: "Chucaolamday@179",
  database: "igoiiqkjhosting_bot-license"
});

module.exports = pool;