"use strict";

const wallet =
    require("./airdrop.wallet.intelligence.service");

const project =
    require("./airdrop.project.service");

const metrics =
    require("./airdrop.metrics.service");

const alert =
    require("./airdrop.alert.service");

async function getDashboard(userId) {

    const portfolio =
        await wallet.getPortfolio(userId);

    const projects =
        await project.getProjectsByUser(userId);

    const alerts =
        await alert.getRecentAlerts(userId);

    return {
        portfolio,
        projects,
        alerts
    };
}

module.exports = {
    getDashboard
};