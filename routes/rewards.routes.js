
"use strict";

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const walletService = require("../services/rewards.wallet.service");

// GET /api/rewards/wallet
router.get("/wallet", auth, async (req, res) => {
    try {
        const wallet = await walletService.getOrCreateWallet(req.user.id);

        return res.json({
            success: true,
            wallet
        });
    } catch (err) {
        console.error("[REWARDS WALLET]", err);

        return res.status(500).json({
            success: false,
            error: "WALLET_LOAD_FAILED"
        });
    }
});

// GET /api/rewards/transactions?page=1&limit=20
router.get("/transactions", auth, async (req, res) => {
    try {
        const result = await walletService.getTransactions(
            req.user.id,
            req.query.page,
            req.query.limit
        );

        return res.json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error("[REWARDS TRANSACTIONS]", err);

        return res.status(500).json({
            success: false,
            error: "TRANSACTIONS_LOAD_FAILED"
        });
    }
});

module.exports = router;
