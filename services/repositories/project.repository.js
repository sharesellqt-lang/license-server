"use strict";

const db = require("../../db");

async function getProjectById(userId, projectId) {

    const [rows] = await db.query(
        `
        SELECT *
        FROM airdrop_projects
        WHERE id = ?
        AND user_id = ?
        LIMIT 1
        `,
        [
            projectId,
            userId
        ]
    );

    return rows[0] || null;
}

module.exports = {
    getProjectById
};