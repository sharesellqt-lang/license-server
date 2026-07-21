// =========================================
// services/airdrop.note.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET NOTES OF PROJECT
========================================= */

async function getNotes(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_notes
        WHERE project_id = ?
        ORDER BY created_at DESC
    `;

    const [rows] =
        await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET ALL NOTES OF USER (Dashboard Batch)
========================================= */

async function getAllNotes(userId) {

    const sql = `
        SELECT
            n.*,
            p.user_id,
            p.name AS project_name
        FROM airdrop_project_notes n
        INNER JOIN airdrop_projects p
            ON p.id = n.project_id
        WHERE p.user_id = ?
        ORDER BY n.project_id ASC,
                 n.created_at DESC
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getNote(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_notes
        WHERE id = ?
        LIMIT 1
    `;

    const [rows] =
        await db.query(sql, [id]);

    return rows[0] || null;

}

/* =========================================
   CREATE
========================================= */

async function createNote(
    projectId,
    userId,
    note
) {

    const sql = `
        INSERT INTO airdrop_project_notes (

            project_id,
            created_by,
            note,
            created_at

        )

        VALUES (?,?,?,?)
    `;

    const now = Date.now();

    const [result] =
        await db.query(sql, [

            Number(projectId),

            Number(userId),

            String(note || "").trim(),

            now

        ]);

    return result.insertId;

}

/* =========================================
   UPDATE
========================================= */

async function updateNote(
    id,
    note
) {

    const sql = `
        UPDATE airdrop_project_notes
        SET

            note = ?

        WHERE id = ?
    `;

    const [result] =
        await db.query(sql, [

            String(note || "").trim(),

            Number(id)

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
        WHERE id = ?
    `;

    const [result] =
        await db.query(sql, [id]);

    return result.affectedRows > 0;

}

/* =========================================
   DELETE ALL OF PROJECT
========================================= */

async function deleteAll(projectId) {

    const sql = `
        DELETE
        FROM airdrop_project_notes
        WHERE project_id = ?
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

    getAllNotes,

    getNote,

    createNote,

    updateNote,

    deleteNote,

    deleteAll

};