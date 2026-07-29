"use strict";

const db = require("../../db");

/* =========================================
   GET PROJECT
========================================= */

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

/* =========================================
   UPDATE BASIC INFO
========================================= */

async function updateProject(userId, projectId, data = {}) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            name = ?,

            url = ?,

            network = ?,

            contract_address = ?,

            token_symbol = ?,

            source = ?,

            coingecko_id = ?,

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            data.name || null,

            data.url || null,

            data.network || null,

            data.contract_address || null,

            data.token_symbol || null,

            data.source || null,

            data.coingecko_id || null,

            projectId,

            userId

        ]

    );

}

/* =========================================
   UPDATE WEBSITE
========================================= */

async function updateWebsite(userId, projectId, website) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            url = ?,

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            website,

            projectId,

            userId

        ]

    );

}

/* =========================================
   UPDATE COINGECKO
========================================= */

async function updateCoinGeckoId(

    userId,

    projectId,

    coingeckoId

) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            coingecko_id = ?,

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            coingeckoId,

            projectId,

            userId

        ]

    );

}

/* =========================================
   UPDATE TOKEN
========================================= */

async function updateTokenInfo(

    userId,

    projectId,

    tokenSymbol,

    contractAddress,

    network

) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            token_symbol = ?,

            contract_address = ?,

            network = ?,

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            tokenSymbol,

            contractAddress,

            network,

            projectId,

            userId

        ]

    );

}

/* =========================================
   SCAN STATUS
========================================= */

async function updateScanStatus(

    userId,

    projectId,

    status

) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            scan_status = ?,

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            status,

            projectId,

            userId

        ]

    );

}

/* =========================================
   LAST SCAN
========================================= */

async function updateLastScan(

    userId,

    projectId

) {

    await db.query(

        `
        UPDATE airdrop_projects

        SET

            last_scan = NOW(),

            updated_at = NOW()

        WHERE id = ?

        AND user_id = ?
        `,

        [

            projectId,

            userId

        ]

    );

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    getProjectById,

    updateProject,

    updateWebsite,

    updateCoinGeckoId,

    updateTokenInfo,

    updateScanStatus,

    updateLastScan

};