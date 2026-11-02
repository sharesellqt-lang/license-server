
"use strict";

const db = require("../db");
const { getRpcUrl, normalizeNetwork } = require("./airdrop.onchain.config");

const connection = typeof db.promise === "function" ? db.promise() : db;

const REQUEST_TIMEOUT = 15000;
const BALANCE_OF_SELECTOR = "70a08231";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SWAP_V2_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const SWAP_V3_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

const SCAN_BLOCK_RANGE = BigInt(process.env.ONCHAIN_SCAN_BLOCK_RANGE || 1000);
const MAX_SCAN_BLOCKS_PER_RUN = BigInt(process.env.ONCHAIN_MAX_BLOCKS_PER_RUN || 10000);

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 ? result[0] : result;
}

function validAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(address || "").trim());
}

function normalizeAddress(address) {
    return String(address || "").trim().toLowerCase();
}

function hexToBigInt(value) {
    return BigInt(value || "0x0");
}

function toHex(value) {
    return "0x" + BigInt(value).toString(16);
}

function formatUnits(rawValue, decimals) {
    const raw = BigInt(rawValue);
    const precision = Number(decimals);

    if (!Number.isInteger(precision) || precision < 0 || precision > 36) {
        throw new Error("Invalid token decimals");
    }

    const unit = 10n ** BigInt(precision);
    const whole = raw / unit;
    const fraction = raw % unit;

    const fractionText = fraction
        .toString()
        .padStart(precision, "0")
        .replace(/0+$/, "");

    return fractionText
        ? `${whole}.${fractionText}`
        : whole.toString();
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
            throw new Error(`RPC empty result: ${method}`);
        }

        return data.result;
    } finally {
        clearTimeout(timer);
    }
}

async function getERC20Balance(network, tokenAddress, walletAddress, decimals = 18) {
    if (!validAddress(tokenAddress) || !validAddress(walletAddress)) {
        throw new Error("Invalid ERC20 or wallet address");
    }

    const precision = Number(decimals);

    if (!Number.isInteger(precision) || precision < 0 || precision > 36) {
        throw new Error("Invalid token decimals");
    }

    const encodedWallet = normalizeAddress(walletAddress)
        .slice(2)
        .padStart(64, "0");

    const result = await rpcCall(network, "eth_call", [
        {
            to: tokenAddress,
            data: `0x${BALANCE_OF_SELECTOR}${encodedWallet}`
        },
        "latest"
    ]);

    if (!/^0x[0-9a-fA-F]+$/.test(result)) {
        throw new Error("Invalid ERC20 balance response");
    }

    const balance = Number(formatUnits(BigInt(result), precision));

    if (!Number.isFinite(balance)) {
        throw new Error("Invalid ERC20 balance");
    }

    return balance;
}

// =========================================
// PROJECT CONFIG
// =========================================

async function getProjectOnchainConfig(projectId) {
    const [assets, wallets] = await Promise.all([
        query(
            `SELECT
                id, chain, asset_role, symbol, contract_address,
                decimals, price_mode, peg_price,
                scan_from_block, last_scanned_block
             FROM airdrop_project_onchain_assets
             WHERE project_id = ?
               AND is_verified = 1
               AND enabled = 1`,
            [projectId]
        ),
        query(
            `SELECT
                chain, address, wallet_type, label, source_url
             FROM airdrop_project_treasury_wallets
             WHERE project_id = ?
               AND is_verified = 1`,
            [projectId]
        )
    ]);

    return { assets, wallets };
}

// =========================================
// CONTRACT DEPLOYMENT BLOCK DISCOVERY
// =========================================

async function hasContractCode(network, address, blockNumber) {
    const code = await rpcCall(network, "eth_getCode", [
        address,
        toHex(blockNumber)
    ]);

    return typeof code === "string" &&
        code !== "0x" &&
        !/^0x0+$/.test(code);
}

async function findContractDeploymentBlock(network, address, latestBlock) {
    if (!validAddress(address)) {
        throw new Error("Invalid contract address");
    }

    if (!(await hasContractCode(network, address, latestBlock))) {
        throw new Error("Contract has no code at latest block");
    }

    if (await hasContractCode(network, address, 0n)) {
        return 0n;
    }

    let low = 0n;
    let high = latestBlock;

    // Binary search: tìm block đầu tiên có contract code.
    while (low < high) {
        const mid = (low + high) / 2n;
        const exists = await hasContractCode(network, address, mid);

        if (exists) {
            high = mid;
        } else {
            low = mid + 1n;
        }
    }

    return low;
}

async function ensureScanStartBlock(asset, latestBlock) {
    if (
        asset.scan_from_block !== null &&
        asset.scan_from_block !== undefined
    ) {
        return BigInt(asset.scan_from_block);
    }

    console.log(
        `[On-chain] Discover deployment block: ${asset.chain} ${asset.contract_address}`
    );

    const deploymentBlock = await findContractDeploymentBlock(
        asset.chain,
        asset.contract_address,
        latestBlock
    );

    await query(
        `UPDATE airdrop_project_onchain_assets
         SET scan_from_block = ?
         WHERE id = ?`,
        [deploymentBlock.toString(), asset.id]
    );

    asset.scan_from_block = deploymentBlock.toString();

    console.log(
        `[On-chain] Deployment block found: ${deploymentBlock.toString()}`
    );

    return deploymentBlock;
}

// =========================================
// LOG HELPERS
// =========================================

function addressToTopic(address) {
    if (!validAddress(address)) {
        throw new Error(`Invalid indexed address: ${address}`);
    }

    return "0x" +
        normalizeAddress(address).slice(2).padStart(64, "0");
}

function topicToAddress(topic) {
    return "0x" + String(topic || "").slice(-40).toLowerCase();
}

async function getLogsAdaptive(network, filter, fromBlock, toBlock) {
    const requestFilter = {
        ...filter,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock)
    };

    try {
        return await rpcCall(network, "eth_getLogs", [requestFilter]);
    } catch (error) {
        if (fromBlock >= toBlock) {
            throw error;
        }

        const middle = (fromBlock + toBlock) / 2n;

        const left = await getLogsAdaptive(
            network,
            filter,
            fromBlock,
            middle
        );

        const right = await getLogsAdaptive(
            network,
            filter,
            middle + 1n,
            toBlock
        );

        return left.concat(right);
    }
}

async function getBlockTimestamp(network, blockNumber, cache) {
    const key = blockNumber.toString();

    if (cache.has(key)) {
        return cache.get(key);
    }

    const block = await rpcCall(
        network,
        "eth_getBlockByNumber",
        [toHex(blockNumber), false]
    );

    if (!block || !block.timestamp) {
        throw new Error(`Cannot read block timestamp: ${key}`);
    }

    const timestamp = Number(hexToBigInt(block.timestamp));

    cache.set(key, timestamp);

    return timestamp;
}

// =========================================
// EVENT STORAGE
// =========================================

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

// =========================================
// TOKEN EVENT SCANNER
// =========================================

async function scanProjectTokenEvents(project, asset, allWallets) {
    const network = asset.chain;
    const contractAddress = normalizeAddress(asset.contract_address);

    if (!validAddress(contractAddress)) {
        throw new Error("Invalid project token contract");
    }

    const latestBlock = hexToBigInt(
        await rpcCall(network, "eth_blockNumber", [])
    );

    const scanStartBlock = await ensureScanStartBlock(
        asset,
        latestBlock
    );

    let fromBlock =
        asset.last_scanned_block !== null &&
        asset.last_scanned_block !== undefined
            ? BigInt(asset.last_scanned_block) + 1n
            : scanStartBlock;

    if (fromBlock > latestBlock) {
        return {
            status: "completed",
            latestBlock: latestBlock.toString(),
            scannedTo: asset.last_scanned_block || scanStartBlock.toString()
        };
    }

    const networkWallets = allWallets.filter(wallet =>
        normalizeNetwork(wallet.chain) === normalizeNetwork(network) &&
        validAddress(wallet.address)
    );

    const buybackWallets = networkWallets.filter(wallet =>
        String(wallet.wallet_type || "").toLowerCase() === "buyback"
    );

    const buybackPools = networkWallets.filter(wallet =>
        String(wallet.wallet_type || "").toLowerCase() === "buyback_pool"
    );

    const buybackWalletMap = new Map(
        buybackWallets.map(wallet => [
            normalizeAddress(wallet.address),
            wallet
        ])
    );

    const poolAddresses = [
        ...new Set(buybackPools.map(wallet =>
            normalizeAddress(wallet.address)
        ))
    ];

    const destinationTopics = [
        addressToTopic(ZERO_ADDRESS),
        addressToTopic(DEAD_ADDRESS),
        ...buybackWallets.map(wallet =>
            addressToTopic(wallet.address)
        )
    ];

    const timestampCache = new Map();

    const maxBlocks = MAX_SCAN_BLOCKS_PER_RUN > 0n
        ? MAX_SCAN_BLOCKS_PER_RUN
        : 10000n;

    const scanEndLimit = fromBlock + maxBlocks - 1n > latestBlock
        ? latestBlock
        : fromBlock + maxBlocks - 1n;

    let scannedTo = fromBlock - 1n;

    while (fromBlock <= scanEndLimit) {
        const toBlock =
            fromBlock + SCAN_BLOCK_RANGE - 1n > scanEndLimit
                ? scanEndLimit
                : fromBlock + SCAN_BLOCK_RANGE - 1n;

        // 1. Token Transfer logs: burn + buyback wallet receipts.
        const transferLogs = await getLogsAdaptive(
            network,
            {
                address: contractAddress,
                topics: [
                    TRANSFER_TOPIC,
                    null,
                    destinationTopics
                ]
            },
            fromBlock,
            toBlock
        );

        // 2. Swap logs from configured DEX pools.
        const swapLogs = [];

        for (const poolAddress of poolAddresses) {
            const logs = await getLogsAdaptive(
                network,
                {
                    address: poolAddress,
                    topics: [[SWAP_V2_TOPIC, SWAP_V3_TOPIC]]
                },
                fromBlock,
                toBlock
            );

            swapLogs.push(...logs);
        }

        const confirmedSwaps = new Set(
            swapLogs.map(log =>
                `${String(log.transactionHash).toLowerCase()}:${normalizeAddress(log.address)}`
            )
        );

        // 3. Classify and save events.
        for (const log of transferLogs) {
            if (!Array.isArray(log.topics) || log.topics.length < 3) {
                continue;
            }

            const fromAddress = topicToAddress(log.topics[1]);
            const toAddress = topicToAddress(log.topics[2]);

            let eventType = null;
            let sourceType = null;

            if (
                toAddress === ZERO_ADDRESS ||
                toAddress === DEAD_ADDRESS
            ) {
                eventType = "burn";
                sourceType = "transfer";
            } else if (buybackWalletMap.has(toAddress)) {
                const isDexBuyback =
                    poolAddresses.includes(fromAddress) &&
                    confirmedSwaps.has(
                        `${String(log.transactionHash).toLowerCase()}:${fromAddress}`
                    );

                const wallet = buybackWalletMap.get(toAddress);

                // Chỉ phân loại official khi địa chỉ có nguồn xác minh.
                if (isDexBuyback) {
                    eventType = "buyback";
                    sourceType = "dex";
                } else if (wallet.source_url) {
                    eventType = "buyback";
                    sourceType = "official_wallet";
                }
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
                contractAddress,
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

        // 4. Only advance after all logs and events are processed.
        await query(
            `UPDATE airdrop_project_onchain_assets
             SET last_scanned_block = ?
             WHERE id = ?`,
            [toBlock.toString(), asset.id]
        );

        scannedTo = toBlock;
        fromBlock = toBlock + 1n;
    }

    const completed = scannedTo >= latestBlock;

    return {
        status: completed ? "completed" : "pending",
        latestBlock: latestBlock.toString(),
        scannedTo: scannedTo.toString()
    };
}

// =========================================
// EVENT METRICS
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
            : row.event_type === "buyback"
                ? "token_buyback"
                : null;

        if (!prefix) continue;
        if (prefix === "token_buyback" && !hasBuybackWallet) continue;

        result[prefix] = Number(row.total_amount);
        result[`${prefix}_24h`] = Number(row.amount_24h);
        result[`${prefix}_30d`] = Number(row.amount_30d);
    }

    return result;
}

// =========================================
// MAIN ON-CHAIN METRICS
// =========================================

async function fetchProjectOnchainMetrics(project, tokenPrice) {
    const { assets, wallets } = await getProjectOnchainConfig(project.id);

    if (!assets.length) {
        return {
            _scanner: {
                status: "not_configured",
                message: "No verified on-chain assets"
            }
        };
    }

    let treasury = 0;
    let stablecoinReserve = 0;
    let hasTreasury = false;
    let hasStablecoin = false;

    const price = Number(tokenPrice);

    // 1. Treasury and stablecoin balances.
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

    // 2. Scan all verified project token contracts.
    const projectTokenAssets = assets.filter(asset =>
        asset.asset_role === "project_token"
    );

    const scanResults = [];

    for (const asset of projectTokenAssets) {
        try {
            const scan = await scanProjectTokenEvents(
                project,
                asset,
                wallets
            );

            scanResults.push({
                asset: asset.symbol,
                chain: asset.chain,
                contract: asset.contract_address,
                ...scan
            });
        } catch (error) {
            scanResults.push({
                asset: asset.symbol,
                chain: asset.chain,
                contract: asset.contract_address,
                status: "failed",
                error: error.message
            });

            console.warn(
                `[On-chain Scanner] Project #${project.id}, ${asset.symbol}:`,
                error.message
            );
        }
    }

    const allScansCompleted =
        projectTokenAssets.length > 0 &&
        scanResults.length === projectTokenAssets.length &&
        scanResults.every(item => item.status === "completed");

    const result = {};

    if (hasTreasury) {
        result.treasury = Number(treasury.toFixed(8));
    }

    if (hasStablecoin) {
        result.stablecoin_reserve = Number(stablecoinReserve.toFixed(8));
    }

    // Never publish a partial historical total as a complete metric.
    if (allScansCompleted) {
        const hasBuybackWallet = wallets.some(wallet =>
            String(wallet.wallet_type || "").toLowerCase() === "buyback" &&
            validAddress(wallet.address)
        );

        Object.assign(
            result,
            await getProjectOnchainEventMetrics(
                project.id,
                hasBuybackWallet
            )
        );
    }

    const failed = scanResults.some(item => item.status === "failed");
    const pending = scanResults.some(item => item.status === "pending");

    result._scanner = {
        status: allScansCompleted
            ? "completed"
            : failed
                ? "failed"
                : pending
                    ? "pending"
                    : "not_configured",
        scans: scanResults
    };

    return result;
}

module.exports = {
    getERC20Balance,
    getProjectOnchainConfig,
    fetchProjectOnchainMetrics
};
