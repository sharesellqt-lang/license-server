// =========================================
// services/collectors/coingecko.search.collector.js
// =========================================

"use strict";

const axios = require("axios");

const BASE_URL =
    "https://api.coingecko.com/api/v3";

const REQUEST_TIMEOUT =
    10000;

const CACHE_TTL =
    5 * 60 * 1000;

/* =========================================
   CACHE
========================================= */

const cache =
    new Map();

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
   REQUEST WITH RETRY
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

            if (

                i < retry &&

                (

                    status === 429 ||

                    status >= 500 ||

                    !status

                )

            ) {

                await new Promise(

                    resolve =>

                        setTimeout(

                            resolve,

                            (i + 1) * 1000

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
   SEARCH
========================================= */

async function searchCoin(
    query
) {

    query =
        String(
            query || ""
        ).trim();

    if (!query) {

        return [];

    }

    const cacheKey =
        query.toLowerCase();

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

                        query

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

                        large:
                            coin.large,

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
   CLEAR CACHE
========================================= */

function clearCache() {

    cache.clear();

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    searchCoin,

    clearCache

};