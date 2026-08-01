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

async function createMember(
    projectId,
    data={}
){

const sql = `

INSERT INTO airdrop_project_team(

project_id,

member_name,

position,

linkedin,

previous_company,

note,

created_at,

experience_years,

is_founder,

github,

twitter,

avatar,

verification_level,

source_url,

influence_score

)

VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)

`;


const values=[


projectId,


data.member_name || "",


data.position || "",


data.linkedin || "",


data.previous_company || "",


data.note || "",


Date.now(),


data.experience_years || 0,


data.is_founder || 0,


data.github || "",


data.twitter || "",


data.avatar || "",


data.verification_level || "low",


data.source_url || "",


data.influence_score || 0


];


const [result]=

await db.query(
    sql,
    values
);


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
   GET ALL MEMBERS OF USER
========================================= */

async function getAllMembers(userId) {

    const sql = `
        SELECT
            t.*,
            p.user_id
        FROM airdrop_project_team t
        INNER JOIN airdrop_projects p
            ON p.id = t.project_id
        WHERE p.user_id = ?
        ORDER BY t.project_id, t.id
    `;

    const [rows] =
        await db.query(sql, [userId]);

    return rows || [];

}

/* =========================================
   UPSERT MEMBER
========================================= */

async function upsertMember(
    projectId,
    data={}
){

    const name =
        String(
            data.member_name || ""
        ).trim();


    if(!projectId || !name){

        return null;

    }



    const [rows] =
        await db.query(

            `
            SELECT id

            FROM airdrop_project_team

            WHERE project_id=?

            AND LOWER(member_name)=LOWER(?)

            LIMIT 1
            `,

            [
                projectId,
                name
            ]

        );



    /*
    ================================
    UPDATE
    ================================
    */


    if(rows.length){


        const id =
            rows[0].id;



        await db.query(

            `
            UPDATE airdrop_project_team

            SET

                position=?,

                linkedin=?,

                twitter=?,

                previous_company=?,

                experience_years=?,

                github=?,

                avatar=?,

                source_url=?,

                updated_at=?

            WHERE id=?

            `,

            [

                data.position || "",

                data.linkedin || "",

                data.twitter || "",

                data.previous_company || "",

                Number(
                    data.experience_years || 0
                ),

                data.github || "",

                data.avatar || "",

                data.source_url || "",

                Date.now(),

                id

            ]

        );


        return id;


    }



    /*
    ================================
    INSERT
    ================================
    */


    const [result] =

        await db.query(

            `
            INSERT INTO airdrop_project_team

            (

                project_id,

                member_name,

                position,

                linkedin,

                previous_company,

                experience_years,

                twitter,

                github,

                avatar,

                source_url,

                created_at,

                updated_at

            )

            VALUES

            (?,?,?,?,?,?,?,?,?,?,?,?)

            `,

            [

                projectId,

                name,

                data.position || "",

                data.linkedin || "",

                data.previous_company || "",

                Number(
                    data.experience_years || 0
                ),

                data.twitter || "",

                data.github || "",

                data.avatar || "",

                data.source_url || "",

                Date.now(),

                Date.now()

            ]

        );



    return result.insertId;

}

/* =========================================
   FIND MEMBER BY NAME
========================================= */

async function findMember(
    projectId,
    memberName
){

    const sql = `

        SELECT *

        FROM airdrop_project_team

        WHERE project_id=?

        AND LOWER(member_name)=LOWER(?)

        LIMIT 1

    `;


    const [rows] =

        await db.query(
            sql,
            [
                projectId,
                memberName
            ]
        );


    return rows[0] || null;

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    getMembers,

    getAllMembers,

    getMember,

    findMember,

    createMember,

    updateMember,

    deleteMember,

    deleteAll,

    upsertMember


};