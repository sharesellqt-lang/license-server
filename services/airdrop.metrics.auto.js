
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
const COINGECKO_CACHE_TTL = 6 * 60 * 60 * 1000;
const COINGECKO_RATE_LIMIT_WAIT = 60 * 60 * 1000;

const coingeckoCache = new Map();
const coingeckoBlockedUntil = new Map();

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
            const error = new Error(`HTTP ${response.status}: ${url}`);
            error.status = response.status;
            error.retryAfter = response.headers.get("retry-after");
            throw error;
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// =============================================
// CHAINLINK RESERVE - ON-CHAIN
// =============================================

const ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";
const CHAINLINK_LINK_CONTRACT = "0x514910771af9ca656af840dff83e8264ecf986ca";
const ERC20_BALANCE_OF_SELECTOR = "70a08231";

async function fetchEthereumRpc(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(ETHEREUM_RPC_URL, {
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
            throw new Error(`Ethereum RPC HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(
                data.error.message || "Ethereum RPC returned an error"
            );
        }

        if (data.result === undefined || data.result === null) {
            throw new Error("Ethereum RPC returned empty result");
        }

        return data.result;

    } finally {
        clearTimeout(timer);
    }
}

async function getERC20Balance(tokenAddress, walletAddress, decimals = 18) {
    const token = String(tokenAddress || "").trim();
    const wallet = String(walletAddress || "").trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
        throw new Error("Invalid ERC20 token address");
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        throw new Error("Invalid Treasury wallet address");
    }

    const encodedWallet = wallet.slice(2).toLowerCase().padStart(64, "0");

    const result = await fetchEthereumRpc("eth_call", [
        {
            to: token,
            data: `0x${ERC20_BALANCE_OF_SELECTOR}${encodedWallet}`
        },
        "latest"
    ]);

    if (!/^0x[0-9a-fA-F]{64}$/.test(result)) {
        throw new Error("Invalid ERC20 balance response");
    }

    const rawBalance = BigInt(result);
    const balance = Number(rawBalance) / (10 ** decimals);

    if (!Number.isFinite(balance)) {
        throw new Error("Invalid ERC20 balance value");
    }

    return balance;
}

async function fetchChainlinkReserveMetrics(project, tokenPrice) {
    if (
        String(project?.coingecko_id || "").toLowerCase() !== "chainlink" ||
        String(project?.contract_address || "").toLowerCase() !==
            CHAINLINK_LINK_CONTRACT.toLowerCase()
    ) {
        return {};
    }

    const wallets = await query(
        `SELECT address
         FROM airdrop_project_treasury_wallets
         WHERE project_id = ?
           AND chain = 'Ethereum'
           AND wallet_type = 'reserve'
           AND is_verified = 1`,
        [project.id]
    );

    if (!wallets.length) {
        throw new Error("No verified Chainlink Reserve wallet found");
    }

    const price = Number(tokenPrice);

    if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Valid LINK current_price is unavailable");
    }

    let totalLink = 0;

    for (const wallet of wallets) {
        const balance = await getERC20Balance(
            CHAINLINK_LINK_CONTRACT,
            wallet.address,
            18
        );

        totalLink += balance;
    }

    const treasuryValue = Number((totalLink * price).toFixed(8));

    if (!Number.isFinite(treasuryValue)) {
        throw new Error("Invalid Chainlink Reserve valuation");
    }

    return {
        treasury: treasuryValue
    };
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
    const coinId = String(project.coingecko_id || "").trim().toLowerCase();
    if (!coinId) return {};

    const now = Date.now();

    // Kiểm tra thời gian bị giới hạn.
    const blockedUntil = coingeckoBlockedUntil.get(coinId) || 0;

    if (now < blockedUntil) {
        throw new Error(
            `CoinGecko rate limited. Retry after ${new Date(blockedUntil).toISOString()}`
        );
    }

    // Sử dụng cache nếu còn hạn.
    const cached = coingeckoCache.get(coinId);

    if (cached && now - cached.timestamp < COINGECKO_CACHE_TTL) {
        return { ...cached.data };
    }

    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;

    try {
        const data = await fetchJSON(url);
        const market = data.market_data || {};

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

        // Chỉ cache khi thực sự có dữ liệu.
        if (Object.keys(result).length) {
            coingeckoCache.set(coinId, {
                timestamp: Date.now(),
                data: result
            });
        }

        coingeckoBlockedUntil.delete(coinId);

        return result;

    } catch (error) {
        if (error.status === 429) {
            let waitTime = COINGECKO_RATE_LIMIT_WAIT;
            const retryAfter = error.retryAfter;

            if (retryAfter) {
                const seconds = Number(retryAfter);

                if (Number.isFinite(seconds) && seconds > 0) {
                    waitTime = seconds * 1000;
                } else {
                    const retryDate = Date.parse(retryAfter);

                    if (Number.isFinite(retryDate)) {
                        waitTime = Math.max(1000, retryDate - Date.now());
                    }
                }
            }

            coingeckoBlockedUntil.set(
                coinId,
                Date.now() + waitTime
            );
        }

        throw error;
    }
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

async function findDefiLlamaSlug(project) {
    const normalize = value =>
        String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

    const nameKey = normalize(project?.name);
    const geckoKey = normalize(project?.coingecko_id);

    if (!nameKey && !geckoKey) {
        throw new Error("Missing project name and CoinGecko ID");
    }

    const protocols = await getDefiLlamaProtocols();

    if (!Array.isArray(protocols)) {
        throw new Error("Invalid DefiLlama protocols response");
    }

    // =========================================
    // 1. DIRECT PROTOCOL MATCH
    // =========================================

    const matches = protocols.filter(item => {
        const itemName = normalize(item.name);
        const itemSlug = normalize(item.slug);

        return (
            (nameKey && (itemName === nameKey || itemSlug === nameKey)) ||
            (geckoKey && itemSlug === geckoKey)
        );
    });

    const geckoMatches = matches.filter(
        item => geckoKey && normalize(item.slug) === geckoKey
    );

    if (geckoMatches.length === 1) {
        return geckoMatches[0].slug;
    }

    const nameMatches = matches.filter(
        item => normalize(item.name) === nameKey
    );

    if (nameMatches.length === 1) {
        return nameMatches[0].slug;
    }

    if (matches.length > 1) {
        throw new Error(
            `Ambiguous DefiLlama match for ${project.name}: ${matches.map(x => x.slug).join(", ")}`
        );
    }

    // =========================================
    // 2. PARENT PROTOCOL RESOLUTION
    // =========================================

    const parentMatches = protocols.filter(item => {
        const parentKey = normalize(item.parentProtocolSlug);

        return (
            parentKey &&
            (parentKey === nameKey || parentKey === geckoKey)
        );
    });

    const parentSlugs = [
        ...new Set(
            parentMatches
                .map(item => item.parentProtocolSlug)
                .filter(Boolean)
        )
    ];

    if (parentSlugs.length === 1) {
        return parentSlugs[0];
    }

    if (parentSlugs.length > 1) {
        throw new Error(
            `Ambiguous DefiLlama parent for ${project.name}: ${parentSlugs.join(", ")}`
        );
    }

    // =========================================
    // 3. NOT FOUND
    // =========================================

    throw new Error(
        `DefiLlama protocol not found: ${project.name} (${project.coingecko_id || "no gecko_id"})`
    );
}

function getRevenueGrowth30d(chart) {
    if (!Array.isArray(chart) || chart.length < 2) return null;

    const rows = chart
        .filter(item =>
            Array.isArray(item) &&
            Number.isFinite(Number(item[0])) &&
            Number.isFinite(Number(item[1])) &&
            Number(item[1]) >= 0
        )
        .map(item => ({
            date: Number(item[0]),
            value: Number(item[1])
        }))
        .sort((a, b) => a.date - b.date);

    if (rows.length < 2) return null;

    const latestTime = rows[rows.length - 1].date;
    const day = 86400;

    const currentStart = latestTime - 30 * day;
    const previousStart = latestTime - 60 * day;

    const currentRows = rows.filter(
        item => item.date > currentStart && item.date <= latestTime
    );

    const previousRows = rows.filter(
        item => item.date > previousStart && item.date <= currentStart
    );

    if (!currentRows.length || !previousRows.length) return null;

    const currentRevenue = currentRows.reduce(
        (sum, item) => sum + item.value, 0
    );

    const previousRevenue = previousRows.reduce(
        (sum, item) => sum + item.value, 0
    );

    if (previousRevenue <= 0) return null;

    return (
        (currentRevenue / previousRevenue - 1) * 100
    );
}

async function fetchDefiLlama(project) {
    const slug = await findDefiLlamaSlug(project);

    const data = await fetchJSON(
        `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`
    );

    const history = Array.isArray(data?.tvl) ? data.tvl : [];

    if (!history.length) {
        throw new Error(
            `DefiLlama returned no TVL history for protocol: ${slug}`
        );
    }

    const latest = history[history.length - 1];
    const tvl = Number(latest.totalLiquidityUSD);

    if (!Number.isFinite(tvl)) {
        throw new Error(
            `Invalid latest TVL value for protocol: ${slug}`
        );
    }

    const result = { tvl };

    const growth7d = getTvlGrowth(history, 7);
    const growth30d = getTvlGrowth(history, 30);

    if (growth7d !== null) result.tvl_growth_7d = growth7d;
    if (growth30d !== null) result.tvl_growth_30d = growth30d;

    // FEES
    try {
        const fees = await fetchJSON(
            `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=dailyFees`
        );

        const feeValue = fees?.total24h;

        if (
            feeValue !== null &&
            feeValue !== undefined &&
            feeValue !== "" &&
            Number.isFinite(Number(feeValue)) &&
            Number(feeValue) >= 0
        ) {
            result.protocol_fee = Number(feeValue);
        }
    } catch (error) {
        console.warn("[DefiLlama Fees]", error.message);
    }

    // REVENUE
    try {
        const revenue = await fetchJSON(
            `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`
        );

        const revenueValue = revenue?.total24h;

        if (
            revenueValue !== null &&
            revenueValue !== undefined &&
            revenueValue !== "" &&
            Number.isFinite(Number(revenueValue)) &&
            Number(revenueValue) >= 0
        ) {
            result.protocol_revenue = Number(revenueValue);
        }

        const revenueGrowth = getRevenueGrowth30d(
            revenue?.totalDataChart
        );

        if (revenueGrowth !== null) {
            result.revenue_growth_30d = revenueGrowth;
        }
    } catch (error) {
        console.warn("[DefiLlama Revenue]", error.message);
    }

    return result;
}

// =============================================
// FETCH ONE PROJECT
// =============================================

async function fetchProjectMetrics(project) {
    const collected = {};
    const fieldSources = {};

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

            for (const [field, value] of Object.entries(data || {})) {
                if (value === undefined || value === null || value === "") continue;

                collected[field] = value;
                fieldSources[field] = "api";
            }

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

    // =========================================
    // CHAINLINK RESERVE
    // =========================================

    try {
        let tokenPrice = collected.current_price;

        // Nếu lần fetch này không có giá, dùng giá đã lưu.
        if (
            tokenPrice === undefined ||
            tokenPrice === null ||
            !Number.isFinite(Number(tokenPrice)) ||
            Number(tokenPrice) <= 0
        ) {
            const rows = await query(
                `SELECT current_price
                 FROM airdrop_project_metrics
                 WHERE project_id = ?
                 LIMIT 1`,
                [project.id]
            );

            tokenPrice = rows[0]?.current_price;
        }

        const reserveData = await fetchChainlinkReserveMetrics(
            project,
            tokenPrice
        );

        const fields = Object.keys(reserveData);

        for (const [field, value] of Object.entries(reserveData)) {
            if (value === undefined || value === null) continue;

            collected[field] = value;
            fieldSources[field] = "onchain";
        }

        sourceResults["Chainlink Reserve"] = {
            success: fields.length > 0,
            fields
        };

    } catch (error) {
        sourceResults["Chainlink Reserve"] = {
            success: false,
            error: error.message
        };

        console.warn(
            `[Airdrop Auto] Chainlink Reserve project #${project.id}:`,
            error.message
        );
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
        collected,
        {
            sourceByField: fieldSources
        }
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
