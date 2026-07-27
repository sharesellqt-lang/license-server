// =========================================
// services/airdrop.wallet.service.js
// =========================================

"use strict";

/*
|--------------------------------------------------------------------------
| AIRDROP WALLET SERVICE
|--------------------------------------------------------------------------
| Hiện tại sử dụng Mock Data.
|
| Sau này chỉ cần thay phần mock bằng:
|
| - LayerZero API
| - Galxe API
| - Zealy API
| - Zora API
| - Snapshot
| - Blockchain RPC
|
| mà không cần sửa Route hay Frontend.
|--------------------------------------------------------------------------
*/

/* =========================================
   HELPERS
========================================= */

function isValidWallet(wallet = "") {

    wallet = String(wallet).trim();

    // EVM

    if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {

        return true;

    }

    // Solana

    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {

        return true;

    }

    return false;

}

function detectChains(wallet = "") {

    wallet = String(wallet).trim();

    if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {

        return ["EVM"];

    }

    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {

        return ["SOLANA"];

    }

    return [];

}

/* =========================================
   MOCK CHECK
========================================= */

function buildMockResult(wallet) {

    const chains =
        detectChains(wallet);

    const eligible =
        false;

    const totalScore =
        0;

    return {

        wallet,

        valid:
            isValidWallet(wallet),

        eligible,

        totalScore,

        chains,

        projects: [],

        checkedAt:
            Date.now()

    };

}

/* =========================================
   CHECK ONE
========================================= */

async function checkWallet(wallet) {

    wallet =
        String(wallet || "")
            .trim();

    if (!wallet) {

        return {

            wallet: "",

            valid: false,

            eligible: false,

            totalScore: 0,

            chains: [],

            projects: [],

            checkedAt:
                Date.now()

        };

    }

    /*
    ------------------------------------------------
    TODO

    Sau này thay bằng:

    const data =
        await fetch(...)

    hoặc

    await ethers.js

    hoặc

    RPC

    ------------------------------------------------
    */

    return buildMockResult(wallet);

}

/* =========================================
   CHECK MULTIPLE
========================================= */

async function checkWallets(wallets = []) {

    if (!Array.isArray(wallets)) {

        return [];

    }

    const uniqueWallets = [

        ...new Set(

            wallets

                .map(

                    wallet =>

                        String(wallet)
                            .trim()

                )

                .filter(Boolean)

        )

    ];

    const results = [];

    for (const wallet of uniqueWallets) {

        const result =
            await checkWallet(wallet);

        results.push(result);

    }

    return results;

}

/* =========================================
   SUMMARY
========================================= */

function summarize(results = []) {

    return {

        total:
            results.length,

        valid:
            results.filter(

                item => item.valid

            ).length,

        eligible:
            results.filter(

                item => item.eligible

            ).length

    };

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    isValidWallet,

    detectChains,

    checkWallet,

    checkWallets,

    summarize

};