"use strict";

const axios = require("axios");

const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

async function sendAlert(data) {

    if (!TELEGRAM_BOT_TOKEN) return;

    const text = `
🚨 ALERT: ${data.project}

Score: ${data.score}
Signals: ${data.signals.length}
Time: ${new Date(data.timestamp).toLocaleString()}
`;

    await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text
        }
    );
}

module.exports = {

    sendAlert

};