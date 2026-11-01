
"use strict";

const db = require("../db");
const metricsService = require("./airdrop.metrics.service");

const connection = typeof db.promise === "function" ? db.promise() : db;

const INTERVAL_HOURS = [0, 6, 12, 18];
const TIMEZONE_OFFSET = 7 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;

let isRunning = false;
let defiProtocolsCache = null;
let defiProtocolsCacheAt = 0;

async function query(sql, params = []) {
    const result = await connection.query(sql, params);
    return Array.isArray(result) && result.length === 2 ? result[0] : result;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
                ...headers
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${url}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// =============================================
// DEXSCREENER - NETWORK
// =============================================

function getDexChainId(network) {
    const value = String(network || "")
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    const networks = {
        ethereum: "ethereum",
        eth: "ethereum",
        "ethereum mainnet": "ethereum",
        bsc: "bsc",
        bnb: "bsc",
        bnbchain: "bsc",
        binancesmartchain: "bsc",
        polygon: "polygon",
        matic: "polygon",
        arbitrum: "arbitrum",
        arbitrumone: "arbitrum",
        base: "base",
        optimism: "optimism",
        avalanche: "avalanche",
        avax: "avalanche",
        fantom: "fantom",
        sonic: "sonic",
        cronos: "cronos",
        linea: "linea",
        blast: "blast",
        zksync: "zksync",
        scroll: "scroll",
        mantle: "mantle",
        celo: "celo",
        opbnb: "opbnb",
        gnosis: "gnosis",
        solana: "solana"
    };

    return networks[value] || null;
}
// =============================================
// DEXSCREENER
// =============================================

async function fetchDexScreener(project) {
    const contract = String(project.contract_address || "").trim();
    const chain = getDexChainId(project.network);

    if (!contract || !chain) return {};

    const data = await fetchJSON(
        `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(contract)}`
    );

    if (!Array.isArray(data) || !data.length) return {};

    // Chỉ chọn pool có đúng token contract.
    const pairs = data.filter(pair =>
        String(pair.chainId || "").toLowerCase() === chain &&
        String(pair.baseToken?.address || "").toLowerCase() === contract.toLowerCase()
    );

    if (!pairs.length) return {};

    // Ưu tiên pool có thanh khoản cao nhất.
    pairs.sort((a, b) =>
        Number(b.liquidity?.usd || 0) -
        Number(a.liquidity?.usd || 0)
    );

    const pair = pairs[0];

    const map = {
        token_symbol: pair.baseToken?.symbol,
        current_price: pair.priceUsd,
        market_cap: pair.marketCap,
        fdv: pair.fdv,
        liquidity: pair.liquidity?.usd,
        volume_24h: pair.volume?.h24,
        price_change_24h: pair.priceChange?.h24
    };

    const result = {};

    for (const [field, value] of Object.entries(map)) {
        if (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            Number.isFinite(
                field === "token_symbol" ? 1 : Number(value)
            )
        ) {
            result[field] = field === "token_symbol"
                ? String(value).slice(0, 30)
                : Number(value);
        }
    }

    return result;
}
async function getActiveProjects() {
    return query(
        `SELECT id, user_id, name, url, network,
                contract_address, coingecko_id
         FROM airdrop_projects
         WHERE status = 'on'
         ORDER BY id ASC`
    );
}

// =============================================
// COINGECKO
// =============================================

async function fetchCoinGecko(project) {
    const coinId = String(project.coingecko_id || "").trim();

    console.log("[CoinGecko] Project:", project.id, project.name);
    console.log("[CoinGecko] Coin ID:", coinId);

    if (!coinId) return {};

    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;

    const data = await fetchJSON(url);
    const market = data.market_data || {};

    console.log("[CoinGecko] Response:", {
        id: data.id,
        hasMarketData: !!data.market_data,
        total_supply: market.total_supply,
        circulating_supply: market.circulating_supply,
        max_supply: market.max_supply
    });

    // Giữ nguyên phần code map và return result bên dưới.
    const result = {};

    const map = {
        token_symbol: data.symbol,
        current_price: market.current_price?.usd,
        total_supply: market.total_supply,
        circulating_supply: market.circulating_supply,
        max_supply: market.max_supply,
        market_cap: market.market_cap?.usd,
        fdv: market.fully_diluted_valuation?.usd,
        volume_24h: market.total_volume?.usd,
        price_change_24h: market.price_change_percentage_24h,
        ath_price: market.ath?.usd,
        atl_price: market.atl?.usd
    };

    for (const [field, value] of Object.entries(map)) {
        if (value !== null && value !== undefined && value !== "") {
            result[field] = value;
        }
    }

    return result;
}

// =============================================
// GITHUB
// =============================================

function getGitHubRepo(projectUrl) {
    if (!projectUrl) return null;

    try {
        const url = new URL(
            /^https?:\/\//i.test(projectUrl)
                ? projectUrl
                : `https://${projectUrl}`
        );

        if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
            return null;
        }

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;

        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, "");

        if (!owner || !repo) return null;

        return { owner, repo };
    } catch {
        return null;
    }
}

function getLastPage(response) {
    const link = response.headers.get("link") || "";
    const match = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/i);

    return match ? Number(match[1]) : null;
}

async function fetchGitHub(project) {
    const repo = getGitHubRepo(project.url);
    if (!repo) return {};

    const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const headers = { "User-Agent": "Airdrop-Project-Analyzer" };

    const response = await fetch(base, { headers });
    if (!response.ok) {
        throw new Error(`GitHub HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = {};

    const map = {
        github_stars: data.stargazers_count,
        github_forks: data.forks_count,
        github_watchers: data.subscribers_count
    };

    for (const [field, value] of Object.entries(map)) {
        if (Number.isFinite(Number(value))) result[field] = Number(value);
    }

    // Các endpoint phụ được xử lý độc lập.
    const since = new Date(Date.now() - 30 * 86400000).toISOString();

    const endpoints = [
        {
            field: "github_contributors",
            url: `${base}/contributors?per_page=1`
        },
        {
            field: "github_releases",
            url: `${base}/releases?per_page=1`
        },
        {
            field: "github_recent_commits",
            url: `${base}/commits?since=${encodeURIComponent(since)}&per_page=1`
        }
    ];

    for (const item of endpoints) {
        try {
            const res = await fetch(item.url, { headers });
            if (!res.ok) continue;

            const body = await res.json();
            const lastPage = getLastPage(res);

            result[item.field] = lastPage !== null
                ? lastPage
                : Array.isArray(body) ? body.length : 0;
        } catch (error) {
            console.warn(`[Airdrop Auto] GitHub ${item.field}:`, error.message);
        }
    }

    return result;
}

// =============================================
// DEFILLAMA
// =============================================

async function getDefiLlamaProtocols() {
    const now = Date.now();

    if (defiProtocolsCache && now - defiProtocolsCacheAt < 6 * 60 * 60 * 1000) {
        return defiProtocolsCache;
    }

    const data = await fetchJSON("https://api.llama.fi/protocols");

    if (!Array.isArray(data)) {
        throw new Error("Invalid DefiLlama protocols response");
    }

    defiProtocolsCache = data;
    defiProtocolsCacheAt = now;

    return data;
}

async function findDefiLlamaSlug(projectName) {
    const name = String(projectName || "").trim().toLowerCase();
    if (!name) return null;

    const protocols = await getDefiLlamaProtocols();

    const matches = protocols.filter(item =>
        String(item.name || "").trim().toLowerCase() === name &&
        item.slug
    );

    // Chỉ chấp nhận kết quả khớp tên duy nhất.
    return matches.length === 1 ? matches[0].slug : null;
}

function getTvlGrowth(history, days) {
    if (!Array.isArray(history) || history.length < 2) return null;

    const latest = history[history.length - 1];
    const targetTime = Number(latest.date) - days * 86400;

    let previous = null;

    for (const item of history) {
        if (Number(item.date) <= targetTime) previous = item;
        else break;
    }

    const currentValue = Number(latest.totalLiquidityUSD);
    const previousValue = Number(previous?.totalLiquidityUSD);

    if (
        !Number.isFinite(currentValue) ||
        !Number.isFinite(previousValue) ||
        previousValue <= 0
    ) return null;

    return ((currentValue / previousValue) - 1) * 100;
}

async function fetchDefiLlama(project) {
    const slug = await findDefiLlamaSlug(project.name);
    if (!slug) return {};

    const data = await fetchJSON(
        `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`
    );

    const history = Array.isArray(data.tvl) ? data.tvl : [];
    if (!history.length) return {};

    const latest = history[history.length - 1];
    const tvl = Number(latest.totalLiquidityUSD);

    if (!Number.isFinite(tvl)) return {};

    const result = { tvl };

    const growth7d = getTvlGrowth(history, 7);
    const growth30d = getTvlGrowth(history, 30);

    if (growth7d !== null) result.tvl_growth_7d = growth7d;
    if (growth30d !== null) result.tvl_growth_30d = growth30d;

    return result;
}

// =============================================
// FETCH ONE PROJECT
// =============================================

async function fetchProjectMetrics(project) {
    const collected = {};

    const sources = [
    ["DexScreener", () => fetchDexScreener(project)],
    ["CoinGecko", () => fetchCoinGecko(project)],
    ["GitHub", () => fetchGitHub(project)],
    ["DefiLlama", () => fetchDefiLlama(project)]
];

    const sourceResults = {};

for (const [name, fetcher] of sources) {
    try {
        const data = await fetcher();
        const fields = Object.keys(data || {});

        Object.assign(collected, data);

        sourceResults[name] = {
            success: fields.length > 0,
            fields
        };

    } catch (error) {
        sourceResults[name] = {
            success: false,
            error: error.message
        };

        console.warn(
            `[Airdrop Auto] ${name} project #${project.id}:`,
            error.message
        );
    }
}

   const fields = Object.keys(collected);

    if (!fields.length) {
        return {
            updated: false,
            fields: [],
            sources: sourceResults
        };
    }

    await metricsService.updateMetrics(
        project.user_id,
        project.id,
        collected
    );

    return {
        updated: true,
        fields,
        sources: sourceResults
    };
}

// =============================================
// RUN ALL PROJECTS
// =============================================

async function runAutoFetch() {
    if (isRunning) {
        return { skipped: true, reason: "already_running" };
    }

    isRunning = true;

    const summary = {
        total: 0,
        updated: 0,
        skipped: 0,
        failed: 0
    };

    try {
        const projects = await getActiveProjects();
        summary.total = projects.length;

        for (const project of projects) {
            try {
                const result = await fetchProjectMetrics(project);

                if (result.updated) summary.updated++;
                else summary.skipped++;
            } catch (error) {
                summary.failed++;
                console.error(
                    `[Airdrop Auto] Project #${project.id}:`,
                    error.message
                );
            }

            await sleep(500);
        }

        console.log("[Airdrop Auto] Completed:", summary);
        return summary;
    } catch (error) {
        console.error("[Airdrop Auto] Failed:", error);
        throw error;
    } finally {
        isRunning = false;
    }
}

// =============================================
// SCHEDULE - VIETNAM TIME
// =============================================

function getNextRunDelay() {
    const now = Date.now();
    const vietnamNow = new Date(now + TIMEZONE_OFFSET);

    const currentHour = vietnamNow.getUTCHours();

    let nextHour = INTERVAL_HOURS.find(hour => hour > currentHour);

    const next = new Date(vietnamNow);

    if (nextHour === undefined) {
        next.setUTCDate(next.getUTCDate() + 1);
        nextHour = INTERVAL_HOURS[0];
    }

    next.setUTCHours(nextHour, 0, 0, 0);

    return Math.max(1000, next.getTime() - vietnamNow.getTime());
}

function scheduleNextRun() {
    const delay = getNextRunDelay();

    console.log(
        `[Airdrop Auto] Next run in ${Math.round(delay / 60000)} minutes`
    );

    setTimeout(async () => {
        try {
            await runAutoFetch();
        } catch (error) {
            console.error("[Airdrop Auto] Scheduled run error:", error.message);
        }

        scheduleNextRun();
    }, delay);
}

scheduleNextRun();

module.exports = {
    runAutoFetch,
    fetchProjectMetrics
};
