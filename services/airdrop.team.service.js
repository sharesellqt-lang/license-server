// =========================================
// services/airdrop.team.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET ALL
========================================= */

async function getMembers(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_team
        WHERE project_id=?
        ORDER BY id ASC
    `;

    const [rows] = await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getMember(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_team
        WHERE id=?
        LIMIT 1
    `;

    const [rows] = await db.query(sql, [id]);

    return rows[0] || null;

}

/* =========================================
   CREATE
========================================= */

async function createMember(projectId, data = {}) {

    const now = Date.now();

    const sql = `
        INSERT INTO airdrop_project_team(

            project_id,
            member_name,
            position,
            linkedin,
            previous_company,
            note,
            created_at

        )

        VALUES(?,?,?,?,?,?,?)
    `;

    const values = [

        projectId,

        data.member_name || "",

        data.position || "",

        data.linkedin || "",

        data.previous_company || "",

        data.note || "",

        now

    ];

    const [result] =
        await db.query(sql, values);

    return result.insertId;

}

/* =========================================
   UPDATE
========================================= */

async function updateMember(id, data = {}) {

    const sql = `
        UPDATE airdrop_project_team
        SET

            member_name=?,

            position=?,

            linkedin=?,

            previous_company=?,

            note=?

        WHERE id=?
    `;

    const values = [

        data.member_name || "",

        data.position || "",

        data.linkedin || "",

        data.previous_company || "",

        data.note || "",

        id

    ];

    const [result] =
        await db.query(sql, values);

    return result.affectedRows > 0;

}

/* =========================================
   DELETE
========================================= */

async function deleteMember(id) {

    const sql = `
        DELETE
        FROM airdrop_project_team
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
        FROM airdrop_project_team
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

    getMembers,

    getMember,

    createMember,

    updateMember,

    deleteMember,

    deleteAll

};