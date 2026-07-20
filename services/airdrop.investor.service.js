// =========================================
// services/airdrop.investor.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET ALL
========================================= */

async function getInvestors(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_investors
        WHERE project_id=?
        ORDER BY id ASC
    `;

    const [rows] = await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getInvestor(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_investors
        WHERE id=?
        LIMIT 1
    `;

    const [rows] = await db.query(sql, [id]);

    return rows[0] || null;

}

/* =========================================
   CREATE
========================================= */

async function createInvestor(projectId, data = {}) {

    const now = Date.now();

    const sql = `
        INSERT INTO airdrop_project_investors(

    project_id,

    investor_name,

    investment_round,

    investment_amount,

    investor_tier,

    website,

    logo,

    note,

    created_at

)

        VALUES(?,?,?,?,?,?,?,?,?)
    `;

   const values = [

    projectId,

    data.investor_name || "",

    data.investment_round || "",

    Number(data.investment_amount || 0),

    data.investor_tier || "normal",

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

async function updateInvestor(id, data = {}) {

    const sql = `
        UPDATE airdrop_project_investors
        SET

            investor_name=?,

            investment_round=?,

            investment_amount=?,

            note=?

        WHERE id=?
    `;

    const values = [

        data.investor_name || "",

        data.investment_round || "",

        Number(data.investment_amount || 0),

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

async function deleteInvestor(id) {

    const sql = `
        DELETE
        FROM airdrop_project_investors
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
        FROM airdrop_project_investors
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

    getInvestors,

    getInvestor,

    createInvestor,

    updateInvestor,

    deleteInvestor,

    deleteAll

};