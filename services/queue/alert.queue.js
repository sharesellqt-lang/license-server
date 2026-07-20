"use strict";

const { Queue } = require("bullmq");

const alertQueue =
    new Queue("alert-queue", {
        connection: {
            host: "127.0.0.1",
            port: 6379
        }
    });

module.exports = alertQueue;