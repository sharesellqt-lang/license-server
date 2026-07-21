// =========================================
// services/airdrop.partner.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET ALL
========================================= */

async function getPartners(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_partners
        WHERE project_id=?
        ORDER BY id ASC
    `;

    const [rows] = await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getPartner(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_partners
        WHERE id=?
        LIMIT 1
    `;

    const [rows] = await db.query(sql, [id]);

    return rows[0] || null;

}

/* =========================================
   CREATE
========================================= */

async function createPartner(projectId, data = {}) {

    const now = Date.now();

    const sql = `
        INSERT INTO airdrop_project_partners(

    project_id,

    partner_name,

    partner_type,

    partner_tier,

    website,

    logo,

    note,

    created_at

)

VALUES(?,?,?,?,?,?,?,?)
    `;

    const values = [

    projectId,

    data.partner_name || "",

    data.partner_type || "",

    data.partner_tier || "normal",

    data.website || "",

    data.logo || "",

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

async function updatePartner(id, data = {}) {

    const sql = `
      UPDATE airdrop_project_partners
SET

    partner_name=?,

    partner_type=?,

    partner_tier=?,

    website=?,

    logo=?,

    note=?

WHERE id=?
    `;

    const values = [

    data.partner_name || "",

    data.partner_type || "",

    data.partner_tier || "normal",

    data.website || "",

    data.logo || "",

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

async function deletePartner(id) {

    const sql = `
        DELETE
        FROM airdrop_project_partners
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
        FROM airdrop_project_partners
        WHERE project_id=?
    `;

    const [result] =
        await db.query(sql, [projectId]);

    return result.affectedRows;

}

/* =========================================
   GET ALL PARTNERS OF USER
========================================= */

async function getAllPartners(userId) {

    const sql = `
        SELECT
            pt.*,
            p.user_id
        FROM airdrop_project_partners pt
        INNER JOIN airdrop_projects p
            ON p.id = pt.project_id
        WHERE p.user_id = ?
        ORDER BY pt.project_id, pt.id
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return rows || [];

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    getPartners,

    getAllPartners,

    getPartner,

    createPartner,

    updatePartner,

    deletePartner,

    deleteAll

};