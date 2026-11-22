
"use strict";

const crypto = require("crypto");
const db = require("../db");

function positiveId(value, error = "INVALID_AFFILIATE_ID") {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
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

/* =====================================================
   PRODUCT
===================================================== */

async function getActiveProduct(productId) {
    productId = positiveId(
        productId,
        "INVALID_AFFILIATE_PRODUCT_ID"
    );

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

    return product;
}

/* =====================================================
   CREATE SHARE LINK
   Không ghi nhận lượt click tại đây.
===================================================== */

async function createLink(userId, productId) {
    userId = positiveId(userId, "INVALID_USER_ID");
    productId = positiveId(
        productId,
        "INVALID_AFFILIATE_PRODUCT_ID"
    );

    const product = await getActiveProduct(productId);
    const destinationUrl = validateLazadaUrl(
        product.affiliate_link
    );

    const clickCode = generateClickCode();

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

    const [result] = await db.execute(
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
            attribution_status,
            link_created_at,
            first_clicked_at,
            click_count
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', NOW(), NULL, 0)`,
        [
            clickCode,
            userId,
            productId,
            product.network_id,
            clickCode,
            finalDestinationUrl
        ]
    );

    return {
        id: result.insertId,
        clickCode,
        productId,
        clickUrl: `/api/affiliate/go/${clickCode}`,
        linkCreatedAt: new Date().toISOString(),
        clickCount: 0
    };
}

/* =====================================================
   CREATE CLICK - COMPATIBILITY
   Giữ API cũ cho Product Detail.
   Click chỉ được ghi nhận khi truy cập clickUrl.
===================================================== */

async function createClick(userId, productId) {
    return createLink(userId, productId);
}

/* =====================================================
   GET USER LINKS
===================================================== */

async function getLinks(userId, options = {}) {
    userId = positiveId(userId, "INVALID_USER_ID");

    const page = Number(options.page ?? 1);
    const limit = Number(options.limit ?? 20);

    if (!Number.isSafeInteger(page) || page < 1) {
        throw new Error("INVALID_PAGE");
    }

    if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
    ) {
        throw new Error("INVALID_LIMIT");
    }

    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM affiliate_clicks
         WHERE user_id = ?`,
        [userId]
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
        `SELECT
            id,
            click_code,
            user_id,
            product_id,
            network_id,
            tracking_sub_id,
            clicked_at,
            attribution_status,
            link_created_at,
            first_clicked_at,
            click_count
         FROM affiliate_clicks
         WHERE user_id = ?
         ORDER BY link_created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
    );

    const links = rows.map(row => ({
        id: row.id,
        clickCode: row.click_code,
        productId: row.product_id,
        networkId: row.network_id,
        trackingSubId: row.tracking_sub_id,
        clickUrl: `/api/affiliate/go/${row.click_code}`,
        clickCount: Number(row.click_count || 0),
        clickedAt: row.clicked_at,
        firstClickedAt: row.first_clicked_at,
        linkCreatedAt: row.link_created_at,
        attributionStatus: row.attribution_status
    }));

    return {
        links,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

/* =====================================================
   RECORD CLICK + GET DESTINATION
===================================================== */

async function getClickDestination(clickCode, requestInfo = {}) {
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

    const storedClickCode =
        destination.searchParams.get("sub_id1");

    if (storedClickCode !== click.click_code) {
        throw new Error("AFFILIATE_CLICK_DESTINATION_MISMATCH");
    }

    const ipHash = hashIp(requestInfo.ip);

    const userAgent = requestInfo.userAgent
        ? String(requestInfo.userAgent).slice(0, 500)
        : null;

    await db.execute(
        `UPDATE affiliate_clicks
         SET
            ip_hash = ?,
            user_agent = ?,
            clicked_at = NOW(),
            first_clicked_at = COALESCE(first_clicked_at, NOW()),
            click_count = click_count + 1
         WHERE id = ?`,
        [
            ipHash,
            userAgent,
            click.id
        ]
    );

    return destination.toString();
}

module.exports = {
    createLink,
    createClick,
    getLinks,
    getClickDestination
};
