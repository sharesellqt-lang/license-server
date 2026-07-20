// =========================================
// services/airdrop.note.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET ALL
========================================= */

async function getNotes(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_notes
        WHERE project_id=?
        ORDER BY created_at DESC
    `;

    const [rows] = await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getNote(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_notes
        WHERE id=?
        LIMIT 1
    `;

    const [rows] = await db.query(sql, [id]);

    return rows[0] || null;

}

/* =========================================
   CREATE
========================================= */

async function createNote(projectId, userId, note) {

    const sql = `
        INSERT INTO airdrop_project_notes(

            project_id,
            created_by,
            note,
            created_at

        )

        VALUES(?,?,?,?)
    `;

    const now = Date.now();

    const [result] =
        await db.query(sql, [

            projectId,

            userId,

            note || "",

            now

        ]);

    return result.insertId;

}

/* =========================================
   UPDATE
========================================= */

async function updateNote(id, note) {

    const sql = `
        UPDATE airdrop_project_notes
        SET
            note=?
        WHERE id=?
    `;

    const [result] =
        await db.query(sql, [

            note || "",

            id

        ]);

    return result.affectedRows > 0;

}

/* =========================================
   DELETE
========================================= */

async function deleteNote(id) {

    const sql = `
        DELETE
        FROM airdrop_project_notes
        WHERE id=?
    `;

    const [result] =
        await db.query(sql, [id]);

    return result.affectedRows > 0;

}

/* =========================================
   DELETE ALL
========================================= */

async function deleteAll(projectId) {

    const sql = `
        DELETE
        FROM airdrop_project_notes
        WHERE project_id=?
    `;

    const [result] =
        await db.query(sql, [projectId]);

    return result.affectedRows;

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    getNotes,

    getNote,

    createNote,

    updateNote,

    deleteNote,

    deleteAll

};