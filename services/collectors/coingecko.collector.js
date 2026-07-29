// =========================================
// services/collectors/coingecko.collector.js
// =========================================

"use strict";

const axios = require("axios");

const BASE_URL =
    "https://api.coingecko.com/api/v3";

const REQUEST_TIMEOUT = 10000;
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

/* =========================================
   MEMORY CACHE
========================================= */

const cache = new Map();

function getCache(key) {

    const item =
        cache.get(key);

    if (!item) {

        return null;

    }

    if (
        Date.now() >
        item.expire
    ) {

        cache.delete(key);

        return null;

    }

    return item.value;

}

function setCache(
    key,
    value
) {

    cache.set(
        key,
        {

            value,

            expire:
                Date.now() +
                CACHE_TTL

        }
    );

}

/* =========================================
   SAFE NUMBER
========================================= */

function number(value) {

    value =
        Number(value);

    if (
        !Number.isFinite(value)
    ) {

        return 0;

    }

    return value;

}

/* =========================================
   RETRY REQUEST
========================================= */

async function requestWithRetry(
    url,
    options = {},
    retry = 2
) {

    let lastError;

    for (
        let i = 0;
        i <= retry;
        i++
    ) {

        try {

            return await axios.get(
                url,
                {

                    timeout:
                        REQUEST_TIMEOUT,

                    ...options

                }
            );

        }

        catch (err) {

            lastError = err;

            const status =
                err.response?.status;

            /*
            Retry only for
            429 / 5xx
            */

            if (

                i < retry &&

                (

                    status === 429 ||

                    status >= 500 ||

                    !status

                )

            ) {

                const wait =

                    (i + 1) * 1000;

                await new Promise(

                    resolve =>

                        setTimeout(
                            resolve,
                            wait
                        )

                );

                continue;

            }

            break;

        }

    }

    throw lastError;

}

/* =========================================
   NORMALIZE MARKET DATA
========================================= */

function normalizeCoin(
    data
) {

    const market =
        data.market_data || {};

    return {

        // =========================
        // BASIC
        // =========================

        coingecko_id:
            data.id || "",

        token_symbol:

            data.symbol

                ?

                data.symbol.toUpperCase()

                :

                "",

        name:
            data.name || "",

        homepage:

            data.links?.homepage?.[0]

            ||

            "",

        github:

            data.links?.repos_url?.github?.[0]

            ||

            "",

        twitter:

            data.links?.twitter_screen_name

            ||

            "",

        telegram:

            data.links?.telegram_channel_identifier

            ||

            "",

        categories:

            Array.isArray(
                data.categories
            )

                ?

                data.categories

                :

                [],

        // =========================
        // PRICE
        // =========================

        current_price:

            number(
                market.current_price?.usd
            ),

        // =========================
        // MARKET CAP
        // =========================

        market_cap:

            number(
                market.market_cap?.usd
            ),

        fdv:

            number(
                market.fully_diluted_valuation?.usd
            ),

        volume_24h:

            number(
                market.total_volume?.usd
            ),

        // =========================
        // SUPPLY
        // =========================

        total_supply:

            number(
                market.total_supply
            ),

        circulating_supply:

            number(
                market.circulating_supply
            ),

        max_supply:

            number(
                market.max_supply
            ),

        // =========================
        // ATH / ATL
        // =========================

        ath_price:

            number(
                market.ath?.usd
            ),

        atl_price:

            number(
                market.atl?.usd
            ),

        // =========================
        // CHANGE
        // =========================

        price_change_24h:

            number(
                market.price_change_percentage_24h
            ),

        price_change_7d:

            number(
                market.price_change_percentage_7d
            ),

        price_change_30d:

            number(
                market.price_change_percentage_30d
            ),

        // =========================
        // SENTIMENT
        // =========================

        sentiment_up:

            number(
                data.sentiment_votes_up_percentage
            ),

        sentiment_down:

            number(
                data.sentiment_votes_down_percentage
            )

    };

}

/* =========================================
   FETCH BY ID
========================================= */

async function fetchById(
    coinId
) {

    if (!coinId) {

        return {

            success: false,

            reason:
                "CoinGecko id is required"

        };

    }

    const cacheKey =
        `coin:${coinId}`;

    const cached =
        getCache(cacheKey);

    if (cached) {

        return cached;

    }

    const url =
        `${BASE_URL}/coins/${coinId}`;

    try {

        const response =
            await requestWithRetry(

                url,

                {

                    params: {

                        localization:
                            false,

                        tickers:
                            false,

                        market_data:
                            true,

                        community_data:
                            false,

                        developer_data:
                            false,

                        sparkline:
                            false

                    }

                }

            );

        const normalized =
            normalizeCoin(
                response.data
            );

        setCache(
            cacheKey,
            normalized
        );

        return normalized;

    }

    catch (err) {

        return {

            success: false,

            reason:
                err.response?.data?.error ||

                err.message ||

                "CoinGecko fetch failed"

        };

    }

}

/* =========================================
   SEARCH
========================================= */

async function searchCoin(
    keyword
) {

    keyword =
        String(
            keyword || ""
        ).trim();

    if (!keyword) {

        return [];

    }

    const cacheKey =
        `search:${keyword.toLowerCase()}`;

    const cached =
        getCache(cacheKey);

    if (cached) {

        return cached;

    }

    try {

        const response =
            await requestWithRetry(

                `${BASE_URL}/search`,

                {

                    params: {

                        query:
                            keyword

                    }

                }

            );

        const coins =

            (response.data.coins || [])

                .map(

                    coin => ({

                        id:
                            coin.id,

                        name:
                            coin.name,

                        symbol:
                            coin.symbol,

                        thumb:
                            coin.thumb,

                        market_cap_rank:
                            coin.market_cap_rank

                    })

                );

        setCache(
            cacheKey,
            coins
        );

        return coins;

    }

    catch (_) {

        return [];

    }

}

/* =========================================
   FETCH BY SYMBOL
========================================= */

async function fetchBySymbol(
    symbol
) {

    const coins =
        await searchCoin(
            symbol
        );

    if (
        !coins.length
    ) {

        return {

            success: false,

            reason:
                "Coin not found"

        };

    }

    return fetchById(
        coins[0].id
    );

}

/* =========================================
   CLEAR CACHE
========================================= */

function clearCache() {

    cache.clear();

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchById,

    fetchBySymbol,

    searchCoin,

    clearCache

};