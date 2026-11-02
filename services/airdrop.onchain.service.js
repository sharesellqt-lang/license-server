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
            `SELECT id, chain, asset_role, symbol, contract_address,
                    decimals, price_mode, peg_price,
                    scan_from_block, last_scanned_block
             FROM airdrop_project_onchain_assets
             WHERE project_id = ?
               AND is_verified = 1
               AND enabled = 1`,
            [projectId]
        ),
        query(
            `SELECT chain, address, wallet_type, label, source_url
             FROM airdrop_project_treasury_wallets
             WHERE project_id = ?
               AND is_verified = 1`,
            [projectId]
        )
    ]);

    return { assets, wallets };
}

// =========================================
// ERC20 TRANSFER / BURN / BUYBACK SCANNER
// =========================================

const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const ZERO_ADDRESS =
    "0x0000000000000000000000000000000000000000";

const DEAD_ADDRESS =
    "0x000000000000000000000000000000000000dEaD";

const SWAP_V2_TOPIC =
    "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

const SWAP_V3_TOPIC =
    "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

const SCAN_BLOCK_RANGE = 1000n;

function addressToTopic(address) {
    return "0x" + String(address).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function topicToAddress(topic) {
    return "0x" + String(topic || "").slice(-40).toLowerCase();
}

function hexToBigInt(value) {
    return BigInt(value || "0x0");
}

async function getBlockTimestamp(network, blockNumber, cache) {
    const key = String(blockNumber);

    if (cache.has(key)) return cache.get(key);

    const block = await rpcCall(
        network,
        "eth_getBlockByNumber",
        ["0x" + BigInt(blockNumber).toString(16), false]
    );

    if (!block?.timestamp) {
        throw new Error(`Cannot read block timestamp: ${key}`);
    }

    const timestamp = Number(hexToBigInt(block.timestamp));
    cache.set(key, timestamp);

    return timestamp;
}

async function saveOnchainEvent(event) {
    await query(
        `INSERT IGNORE INTO airdrop_project_onchain_events
        (
            project_id, chain, contract_address, event_type,
            tx_hash, log_index, block_number, block_timestamp,
            from_address, to_address, amount, source_type
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            event.projectId,
            event.chain,
            event.contractAddress,
            event.eventType,
            event.txHash,
            event.logIndex,
            event.blockNumber,
            event.blockTimestamp,
            event.fromAddress,
            event.toAddress,
            event.amount,
            event.sourceType
        ]
    );
}

async function scanProjectTokenEvents(project, asset, wallets) {
    const network = asset.chain;

    const startBlock = asset.last_scanned_block !== null &&
        asset.last_scanned_block !== undefined
        ? BigInt(asset.last_scanned_block) + 1n
        : asset.scan_from_block !== null &&
          asset.scan_from_block !== undefined
            ? BigInt(asset.scan_from_block)
            : null;

    // Không tự đoán block bắt đầu.
    if (startBlock === null) return false;

    const latestBlock = hexToBigInt(
        await rpcCall(network, "eth_blockNumber", [])
    );

    if (startBlock > latestBlock) return true;

    const normalizedWallets = wallets.filter(wallet =>
        normalizeNetwork(wallet.chain) === normalizeNetwork(network)
    );

    const buybackWallets = normalizedWallets.filter(wallet =>
        String(wallet.wallet_type || "").toLowerCase() === "buyback"
    );

    const buybackPools = normalizedWallets.filter(wallet =>
        String(wallet.wallet_type || "").toLowerCase() === "buyback_pool"
    );

    const buybackWalletMap = new Map(
        buybackWallets.map(wallet => [
            String(wallet.address).toLowerCase(),
            wallet
        ])
    );

    const poolAddresses = buybackPools.map(wallet =>
        String(wallet.address).toLowerCase()
    );

    const destinationTopics = [
        addressToTopic(ZERO_ADDRESS),
        addressToTopic(DEAD_ADDRESS),
        ...buybackWallets.map(wallet => addressToTopic(wallet.address))
    ];

    const timestampCache = new Map();

    for (
        let fromBlock = startBlock;
        fromBlock <= latestBlock;
        fromBlock += SCAN_BLOCK_RANGE
    ) {
        const toBlock = fromBlock + SCAN_BLOCK_RANGE - 1n > latestBlock
            ? latestBlock
            : fromBlock + SCAN_BLOCK_RANGE - 1n;

        const fromHex = "0x" + fromBlock.toString(16);
        const toHex = "0x" + toBlock.toString(16);

        // -------------------------------------
        // 1. ERC20 TRANSFER LOGS
        // -------------------------------------

        const transferLogs = await rpcCall(
            network,
            "eth_getLogs",
            [{
                address: asset.contract_address,
                fromBlock: fromHex,
                toBlock: toHex,
                topics: [
                    TRANSFER_TOPIC,
                    null,
                    destinationTopics
                ]
            }]
        );

        // -------------------------------------
        // 2. DEX SWAP LOGS
        // -------------------------------------

        let swapLogs = [];

        if (poolAddresses.length) {
            swapLogs = await rpcCall(
                network,
                "eth_getLogs",
                [{
                    address: poolAddresses,
                    fromBlock: fromHex,
                    toBlock: toHex,
                    topics: [[SWAP_V2_TOPIC, SWAP_V3_TOPIC]]
                }]
            );
        }

        const confirmedSwaps = new Set(
            swapLogs.map(log =>
                `${String(log.transactionHash).toLowerCase()}:${String(log.address).toLowerCase()}`
            )
        );

        // -------------------------------------
        // 3. CLASSIFY EVENTS
        // -------------------------------------

        for (const log of transferLogs) {
            const fromAddress = topicToAddress(log.topics?.[1]);
            const toAddress = topicToAddress(log.topics?.[2]);

            let eventType = null;
            let sourceType = null;

            if (
                toAddress === ZERO_ADDRESS.toLowerCase() ||
                toAddress === DEAD_ADDRESS.toLowerCase()
            ) {
                eventType = "burn";
                sourceType = "transfer";
            } else if (buybackWalletMap.has(toAddress)) {
                eventType = "buyback";

                const isDexBuyback =
                    poolAddresses.includes(fromAddress) &&
                    confirmedSwaps.has(
                        `${String(log.transactionHash).toLowerCase()}:${fromAddress}`
                    );

                sourceType = isDexBuyback ? "dex" : "official";
            }

            if (!eventType) continue;

            const blockNumber = hexToBigInt(log.blockNumber);
            const timestamp = await getBlockTimestamp(
                network,
                blockNumber,
                timestampCache
            );

            const blockTimestamp = new Date(timestamp * 1000)
                .toISOString()
                .slice(0, 19)
                .replace("T", " ");

            const amount = formatUnits(
                hexToBigInt(log.data),
                Number(asset.decimals)
            );

            await saveOnchainEvent({
                projectId: project.id,
                chain: network,
                contractAddress: asset.contract_address,
                eventType,
                txHash: String(log.transactionHash).toLowerCase(),
                logIndex: Number(hexToBigInt(log.logIndex)),
                blockNumber: blockNumber.toString(),
                blockTimestamp,
                fromAddress,
                toAddress,
                amount,
                sourceType
            });
        }

        // -------------------------------------
        // 4. UPDATE SCAN PROGRESS
        // -------------------------------------

        await query(
            `UPDATE airdrop_project_onchain_assets
             SET last_scanned_block = ?
             WHERE id = ?`,
            [toBlock.toString(), asset.id]
        );
    }

    return true;
}

// =========================================
// AGGREGATE BURN / BUYBACK METRICS
// =========================================

async function getProjectOnchainEventMetrics(projectId, hasBuybackWallet) {
    const rows = await query(
        `SELECT
            event_type,
            COALESCE(SUM(amount), 0) AS total_amount,
            COALESCE(SUM(
                CASE
                    WHEN block_timestamp >= UTC_TIMESTAMP() - INTERVAL 1 DAY
                    THEN amount ELSE 0
                END
            ), 0) AS amount_24h,
            COALESCE(SUM(
                CASE
                    WHEN block_timestamp >= UTC_TIMESTAMP() - INTERVAL 30 DAY
                    THEN amount ELSE 0
                END
            ), 0) AS amount_30d
         FROM airdrop_project_onchain_events
         WHERE project_id = ?
         GROUP BY event_type`,
        [projectId]
    );

    const result = {
        token_burn: 0,
        token_burn_24h: 0,
        token_burn_30d: 0
    };

    if (hasBuybackWallet) {
        result.token_buyback = 0;
        result.token_buyback_24h = 0;
        result.token_buyback_30d = 0;
    }

    for (const row of rows) {
        const prefix = row.event_type === "burn"
            ? "token_burn"
            : "token_buyback";

        if (prefix === "token_buyback" && !hasBuybackWallet) continue;

        result[prefix] = Number(row.total_amount);
        result[`${prefix}_24h`] = Number(row.amount_24h);
        result[`${prefix}_30d`] = Number(row.amount_30d);
    }

    return result;
}
async function fetchProjectOnchainMetrics(project, tokenPrice) {
    const { assets, wallets } = await getProjectOnchainConfig(project.id);

    if (!assets.length) return {};

    let treasury = 0;
    let stablecoinReserve = 0;
    let hasTreasury = false;
    let hasStablecoin = false;

    const price = Number(tokenPrice);

    // =========================================
    // TREASURY / STABLECOIN BALANCES
    // =========================================

    for (const asset of assets) {
        const assetChain = normalizeNetwork(asset.chain);

        const matchingWallets = wallets.filter(wallet =>
            normalizeNetwork(wallet.chain) === assetChain &&
            ["treasury", "reserve"].includes(
                String(wallet.wallet_type || "").toLowerCase()
            )
        );

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

    // =========================================
    // TOKEN BURN / BUYBACK SCANNER
    // =========================================

    const projectTokenAssets = assets.filter(
        asset => asset.asset_role === "project_token"
    );

    let eventScanReady = projectTokenAssets.length > 0;

    for (const asset of projectTokenAssets) {
        try {
            const scanned = await scanProjectTokenEvents(
                project,
                asset,
                wallets
            );

            if (!scanned) {
                eventScanReady = false;
            }

        } catch (error) {
            eventScanReady = false;

            console.warn(
                `[On-chain Scanner] Project #${project.id}, ${asset.symbol}:`,
                error.message
            );
        }
    }

    // =========================================
    // BUILD RESULT
    // =========================================

    const result = {};

    if (hasTreasury) {
        result.treasury = Number(treasury.toFixed(8));
    }

    if (hasStablecoin) {
        result.stablecoin_reserve = Number(stablecoinReserve.toFixed(8));
    }

    if (eventScanReady) {
        const eventMetrics = await getProjectOnchainEventMetrics(
            project.id,
            wallets.some(wallet =>
                String(wallet.wallet_type || "").toLowerCase() === "buyback"
            )
        );

        Object.assign(result, eventMetrics);
    }

    return result;
}

module.exports = {
    getERC20Balance,
    getProjectOnchainConfig,
    fetchProjectOnchainMetrics
};