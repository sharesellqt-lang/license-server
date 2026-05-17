const bcrypt = require("bcrypt");

async function run() {
  const hash = await bcrypt.hash("Chactaitaman@789", 10);
  console.log(hash);
}

run();