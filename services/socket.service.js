"use strict";

let io = null;

function init(server) {

    const { Server } =
        require("socket.io");

    io = new Server(server, {
        cors: {
            origin: "*"
        }
    });

    io.on("connection", socket => {

        console.log("Socket connected:", socket.id);

        socket.on("join", userId => {

            socket.join(`user_${userId}`);

        });

    });

}

function emitToUser(userId, event, data) {

    if (!io) return;

    io.to(`user_${userId}`).emit(event, data);

}

module.exports = {

    init,
    emitToUser
};