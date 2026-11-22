
"use strict";

const crypto = require("crypto");
const db = require("../db");

function positiveId(value, error = "INVALID_AFFILIATE_ID") {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(error);
    }
    return id;
}

function generateClickCode() {
    return crypto.randomBytes(16).toString("hex");
}

function hashIp(ip) {
    if (!ip) return null;

    const secret =
        process.env.AFFILIATE_IP_HASH_SECRET ||
        process.env.JWT_SECRET;

    if (!secret) {
        throw new Error("AFFILIATE_IP_HASH_SECRET_REQUIRED");
    }

    return crypto
        .createHmac("sha256", secret)
        .update(String(ip))
        .digest("hex");
}

function validateLazadaUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error("INVALID_AFFILIATE_DESTINATION");
    }

    const hostname = url.hostname.toLowerCase();

    if (
        url.protocol !== "https:" ||
        !(
            hostname === "lazada.vn" ||
            hostname.endsWith(".lazada.vn")
        )
    ) {
        throw new Error("INVALID_AFFILIATE_DESTINATION");
    }

    return url.toString();
}



async function createClick(userId, productId, requestInfo = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");
    productId = positiveId(productId, "INVALID_AFFILIATE_PRODUCT_ID");

    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.network_id,
            p.product_id,
            p.sku_id,
            p.affiliate_link,
            p.status AS product_status,
            n.code AS network_code,
            n.status AS network_status
         FROM affiliate_products p
         JOIN affiliate_networks n ON n.id = p.network_id
         WHERE p.id = ?
         LIMIT 1`,
        [productId]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_PRODUCT_NOT_FOUND");
    }

    const product = rows[0];

    if (product.product_status !== "active") {
        throw new Error("AFFILIATE_PRODUCT_INACTIVE");
    }

    if (product.network_status !== "active") {
        throw new Error("AFFILIATE_NETWORK_INACTIVE");
    }

    if (product.network_code !== "lazada") {
        throw new Error("UNSUPPORTED_AFFILIATE_NETWORK");
    }

    const destinationUrl = validateLazadaUrl(product.affiliate_link);
    const clickCode = generateClickCode();

    // Sub ID 1 là mã đối chiếu duy nhất giữa click và conversion.
    const subIds = {
        sub_id1: clickCode,
        sub_id2: "toolshub",
        sub_id3: `u${userId}`,
        sub_id4: `p${productId}`
    };

    const trackedUrl = new URL(destinationUrl);

    for (const [key, value] of Object.entries(subIds)) {
        trackedUrl.searchParams.set(key, value);
    }

    const finalDestinationUrl = trackedUrl.toString();

    await db.execute(
        `INSERT INTO affiliate_clicks (
            click_code,
            user_id,
            product_id,
            network_id,
            tracking_sub_id,
            destination_url,
            ip_hash,
            user_agent,
            clicked_at,
            attribution_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
        [
            clickCode,
            userId,
            productId,
            product.network_id,
            clickCode,
            finalDestinationUrl,
            hashIp(requestInfo.ip),
            requestInfo.userAgent
                ? String(requestInfo.userAgent).slice(0, 500)
                : null
        ]
    );

    return {
        clickCode,
        productId,
        clickUrl: `/api/affiliate/go/${clickCode}`
    };
}


async function getClickDestination(clickCode) {
    clickCode = String(clickCode || "").trim().toLowerCase();

    if (!/^[a-f0-9]{32}$/.test(clickCode)) {
        throw new Error("INVALID_AFFILIATE_CLICK_CODE");
    }

    const [rows] = await db.execute(
        `SELECT
            c.id,
            c.click_code,
            c.user_id,
            c.product_id,
            c.network_id,
            c.destination_url,
            c.attribution_status,
            p.status AS product_status,
            n.status AS network_status,
            n.code AS network_code
         FROM affiliate_clicks c
         JOIN affiliate_products p ON p.id = c.product_id
         JOIN affiliate_networks n ON n.id = c.network_id
         WHERE c.click_code = ?
         LIMIT 1`,
        [clickCode]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_CLICK_NOT_FOUND");
    }

    const click = rows[0];

    if (
        click.product_status !== "active" ||
        click.network_status !== "active"
    ) {
        throw new Error("AFFILIATE_CLICK_NOT_ELIGIBLE");
    }

    if (click.network_code !== "lazada") {
        throw new Error("UNSUPPORTED_AFFILIATE_NETWORK");
    }

    const destination = new URL(
    validateLazadaUrl(click.destination_url)
    );

    const storedClickCode = destination.searchParams.get("sub_id1");

    if (storedClickCode !== click.click_code) {
        throw new Error("AFFILIATE_CLICK_DESTINATION_MISMATCH");
    }

    return destination.toString();
}

module.exports = {
    createClick,
    getClickDestination
};
