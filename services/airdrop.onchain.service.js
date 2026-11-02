"use strict";

const db = require("../db");
const { getRpcUrl, normalizeNetwork } = require("./airdrop.onchain.config");

const connection = typeof db.promise === "function" ? db.promise() : db;
const REQUEST_TIMEOUT = 15000;
const BALANCE_OF_SELECTOR = "70a08231";

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 ? result[0] : result;
}

async function rpcCall(network, method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(getRpcUrl(network), {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method,
                params
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`RPC HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || "RPC error");
        }

        if (data.result === undefined || data.result === null) {
            throw new Error("RPC returned empty result");
        }

        return data.result;
    } finally {
        clearTimeout(timer);
    }
}

function formatUnits(rawValue, decimals) {
    const raw = BigInt(rawValue);
    const unit = 10n ** BigInt(decimals);
    const whole = raw / unit;
    const fraction = raw % unit;

    const fractionText = fraction
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");

    return fractionText
        ? `${whole}.${fractionText}`
        : whole.toString();
}

async function getERC20Balance(network, tokenAddress, walletAddress, decimals = 18) {
    const token = String(tokenAddress || "").trim();
    const wallet = String(walletAddress || "").trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
        throw new Error("Invalid ERC20 token address");
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        throw new Error("Invalid wallet address");
    }

    const precision = Number(decimals);

    if (!Number.isInteger(precision) || precision < 0 || precision > 36) {
        throw new Error("Invalid token decimals");
    }

    const encodedWallet = wallet.slice(2).toLowerCase().padStart(64, "0");

    const result = await rpcCall(network, "eth_call", [
        {
            to: token,
            data: `0x${BALANCE_OF_SELECTOR}${encodedWallet}`
        },
        "latest"
    ]);

    if (!/^0x[0-9a-fA-F]{64}$/.test(result)) {
        throw new Error("Invalid ERC20 balance response");
    }

    const balance = Number(formatUnits(BigInt(result), precision));

    if (!Number.isFinite(balance)) {
        throw new Error("Invalid ERC20 balance value");
    }

    return balance;
}

async function getProjectOnchainConfig(projectId) {
    const [assets, wallets] = await Promise.all([
        query(
            `SELECT chain, asset_role, symbol, contract_address,
                    decimals, price_mode, peg_price
             FROM airdrop_project_onchain_assets
             WHERE project_id = ?
               AND is_verified = 1
               AND enabled = 1`,
            [projectId]
        ),
        query(
            `SELECT chain, address, wallet_type
             FROM airdrop_project_treasury_wallets
             WHERE project_id = ?
               AND is_verified = 1`,
            [projectId]
        )
    ]);

    return { assets, wallets };
}

async function fetchProjectOnchainMetrics(project, tokenPrice) {
    const { assets, wallets } = await getProjectOnchainConfig(project.id);

    if (!assets.length || !wallets.length) return {};

    let treasury = 0;
    let stablecoinReserve = 0;
    let hasTreasury = false;
    let hasStablecoin = false;

    const price = Number(tokenPrice);

    for (const asset of assets) {
        const assetChain = normalizeNetwork(asset.chain);

        const matchingWallets = wallets.filter(wallet =>
            normalizeNetwork(wallet.chain) === assetChain &&
            ["treasury", "reserve"].includes(
                String(wallet.wallet_type || "").toLowerCase()
            )
        );

        if (!matchingWallets.length) continue;

        for (const wallet of matchingWallets) {
            const balance = await getERC20Balance(
                asset.chain,
                asset.contract_address,
                wallet.address,
                asset.decimals
            );

            if (asset.asset_role === "project_token") {
                if (asset.price_mode !== "token_price") continue;
                if (!Number.isFinite(price) || price <= 0) continue;

                treasury += balance * price;
                hasTreasury = true;
            }

            if (asset.asset_role === "stablecoin") {
                let unitPrice = 0;

                if (asset.price_mode === "peg") {
                    unitPrice = Number(asset.peg_price);
                } else if (asset.price_mode === "token_price") {
                    unitPrice = price;
                }

                if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                    throw new Error(`Invalid price for ${asset.symbol}`);
                }

                stablecoinReserve += balance * unitPrice;
                hasStablecoin = true;
            }
        }
    }

    const result = {};

    if (hasTreasury) {
        result.treasury = Number(treasury.toFixed(8));
    }

    if (hasStablecoin) {
        result.stablecoin_reserve = Number(stablecoinReserve.toFixed(8));
    }

    return result;
}

module.exports = {
    getERC20Balance,
    getProjectOnchainConfig,
    fetchProjectOnchainMetrics
};