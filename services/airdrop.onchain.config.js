"use strict";

const NETWORKS = {
    ethereum: ["ethereum", "eth", "ethereum mainnet"],
    bsc: ["bsc", "bnb", "bnb chain", "binance smart chain"],
    polygon: ["polygon", "matic"],
    arbitrum: ["arbitrum", "arbitrum one"],
    base: ["base"],
    optimism: ["optimism"],
    avalanche: ["avalanche", "avax"],
    fantom: ["fantom"],
    sonic: ["sonic"],
    cronos: ["cronos"],
    linea: ["linea"],
    blast: ["blast"],
    zksync: ["zksync"],
    scroll: ["scroll"],
    mantle: ["mantle"],
    celo: ["celo"],
    opbnb: ["opbnb"],
    gnosis: ["gnosis"]
};

const DEFAULT_RPCS = {
    ethereum: "https://ethereum-rpc.publicnode.com"
};

function normalizeNetwork(network) {
    const value = String(network || "").trim().toLowerCase();

    for (const [key, aliases] of Object.entries(NETWORKS)) {
        if (aliases.includes(value)) return key;
    }

    return value.replace(/[\s_-]/g, "");
}

function getRpcUrl(network) {
    const key = normalizeNetwork(network);

    let customRpcs = {};

    try {
        customRpcs = JSON.parse(process.env.EVM_RPC_URLS || "{}");
    } catch {
        throw new Error("Invalid EVM_RPC_URLS JSON configuration");
    }

    const url = customRpcs[key] || DEFAULT_RPCS[key];

    if (!url) {
        throw new Error(`RPC URL is not configured for network: ${key}`);
    }

    return url;
}

module.exports = {
    normalizeNetwork,
    getRpcUrl
};