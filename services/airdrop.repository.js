// =========================================
// services/airdrop.repository.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   BASE QUERY WRAPPER
========================================= */

async function query(sql, params = []) {

    const [rows] = await db.query(sql, params);

    return rows;
}

/* =========================================
   PROJECTS
========================================= */

async function getProjectsByUser(userId) {

    return query(
        `
        SELECT *
        FROM airdrop_projects
        WHERE user_id=?
        ORDER BY created_at DESC
        `,
        [userId]
    );
}

async function getProjectById(userId, id) {

    const rows = await query(
        `
        SELECT *
        FROM airdrop_projects
        WHERE user_id=? AND id=?
        LIMIT 1
        `,
        [userId, id]
    );

    return rows[0] || null;
}

async function insertProject(values) {

    const sql = `
        INSERT INTO airdrop_projects (
            user_id,
            name,
            url,
            start_date,
            end_date,
            tasks,
            interactions,
            status,
            result,
            fees,
            source,
            created_at,
            updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    const [result] = await db.query(sql, values);

    return result.insertId;
}

async function updateProject(id, userId, values) {

    const sql = `
        UPDATE airdrop_projects
        SET
            name=?,
            url=?,
            start_date=?,
            end_date=?,
            tasks=?,
            interactions=?,
            status=?,
            result=?,
            fees=?,
            source=?,
            updated_at=?
        WHERE id=? AND user_id=?
    `;

    const [result] = await db.query(sql, [
        ...values,
        id,
        userId
    ]);

    return result.affectedRows > 0;
}

async function deleteProject(userId, id) {

    const [result] = await db.query(
        `
        DELETE FROM airdrop_projects
        WHERE id=? AND user_id=?
        `,
        [id, userId]
    );

    return result.affectedRows > 0;
}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    query,

    getProjectsByUser,
    getProjectById,

    insertProject,
    updateProject,
    deleteProject
};