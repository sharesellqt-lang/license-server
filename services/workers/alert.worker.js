"use strict";

const { Worker } = require("bullmq");

const telegramService =
    require("../services/telegram.service");

const socketService =
    require("../services/socket.service");

const worker =
    new Worker(
        "alert-queue",

        async job => {

            const data = job.data;

            console.log(
                "[ALERT WORKER]",
                data.project
            );

            /* =================================
               1. TELEGRAM PUSH
            ================================= */

            await telegramService.sendAlert(
                data
            );

            /* =================================
               2. WEBSOCKET PUSH
            ================================= */

            socketService.emitToUser(
                data.userId,
                "new_alert",
                data
            );

            return true;
        },

        {
            connection: {
                host: "127.0.0.1",
                port: 6379
            }
        }
    );

module.exports = worker;