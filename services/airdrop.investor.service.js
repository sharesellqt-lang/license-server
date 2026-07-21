// =========================================
// services/airdrop.investor.service.js
// =========================================

"use strict";

const db = require("../db");

/* =========================================
   GET ALL OF PROJECT
========================================= */

async function getInvestors(projectId) {

    const sql = `
        SELECT *
        FROM airdrop_project_investors
        WHERE project_id = ?
        ORDER BY id ASC
    `;

    const [rows] =
        await db.query(sql, [projectId]);

    return rows || [];

}

/* =========================================
   GET ALL OF USER (Dashboard Batch)
========================================= */

async function getAllInvestors(userId) {

    const sql = `
        SELECT
            i.*,
            p.user_id,
            p.name AS project_name
        FROM airdrop_project_investors i
        INNER JOIN airdrop_projects p
            ON p.id = i.project_id
        WHERE p.user_id = ?
        ORDER BY i.project_id ASC, i.id ASC
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return rows || [];

}

/* =========================================
   GET BY ID
========================================= */

async function getInvestor(id) {

    const sql = `
        SELECT *
        FROM airdrop_project_investors
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

async function createInvestor(projectId, data = {}) {

    const now = Date.now();

    const sql = `
        INSERT INTO airdrop_project_investors (

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

        VALUES (?,?,?,?,?,?,?,?,?)
    `;

    const values = [

        Number(projectId),

        String(data.investor_name || "").trim(),

        String(data.investment_round || "").trim(),

        Number(data.investment_amount || 0),

        String(data.investor_tier || "normal").trim(),

        String(data.website || "").trim(),

        String(data.logo || "").trim(),

        String(data.note || "").trim(),

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

            investor_name = ?,

            investment_round = ?,

            investment_amount = ?,

            investor_tier = ?,

            website = ?,

            logo = ?,

            note = ?

        WHERE id = ?
    `;

    const values = [

        String(data.investor_name || "").trim(),

        String(data.investment_round || "").trim(),

        Number(data.investment_amount || 0),

        String(data.investor_tier || "normal").trim(),

        String(data.website || "").trim(),

        String(data.logo || "").trim(),

        String(data.note || "").trim(),

        Number(id)

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
        FROM airdrop_project_investors
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

    getInvestors,

    getAllInvestors,

    getInvestor,

    createInvestor,

    updateInvestor,

    deleteInvestor,

    deleteAll

};