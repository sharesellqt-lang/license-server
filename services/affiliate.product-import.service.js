
"use strict";

const db = require("../db");
const productService = require("./affiliate.product.service");

const MAX_IMPORT_ROWS = 2000;

const ALLOWED_SYNC_TYPES = [
    "manual_import",
    "csv_import",
    "excel_import",
    "api_sync"
];

// =====================================================
// NORMALIZE HELPERS
// =====================================================

function normalizeKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function normalizeRow(row = {}) {
    const result = {};

    for (const [key, value] of Object.entries(row)) {
        result[normalizeKey(key)] = value;
    }

    return result;
}

function pick(row, ...keys) {
    for (const key of keys) {
        const value = row[normalizeKey(key)];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
        ) {
            return value;
        }
    }

    return null;
}

function cleanText(value, maxLength = 500, field = "unknown") {
    if (value === undefined || value === null) return null;

    const result = String(value).trim();
    if (!result) return null;

    if (result.length > maxLength) {
        const error = new Error("INVALID_PRODUCT_TEXT_LENGTH");
        error.field = field;
        error.actualLength = result.length;
        error.maxLength = maxLength;
        throw error;
    }

    return result;
}

// =====================================================
// PRICE NORMALIZATION
// =====================================================


function parsePrice(value, currency = "VND") {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value === "number") {
        if (
            !Number.isFinite(value) ||
            value < 0 ||
            value > 9999999999999.99
        ) {
            throw new Error("INVALID_PRODUCT_PRICE");
        }

        return value;
    }

    let raw = String(value)
        .trim()
        .replace(/[^\d,.-]/g, "");

    if (!raw || !/\d/.test(raw)) {
        throw new Error("INVALID_PRODUCT_PRICE");
    }

    const normalizedCurrency = String(currency || "VND")
        .trim()
        .toUpperCase();

    if (normalizedCurrency === "VND") {
        if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
            raw = raw.replace(/\./g, "");
        } else if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
            raw = raw.replace(/,/g, "");
        } else if (/^\d+\.0+$/.test(raw)) {
            raw = raw.split(".")[0];
        } else if (!/^\d+$/.test(raw)) {
            throw new Error("INVALID_PRODUCT_PRICE");
        }
    } else {
        if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
            raw = raw.replace(/,/g, "");
        } else if (/^\d+,\d+$/.test(raw)) {
            raw = raw.replace(",", ".");
        } else if (!/^\d+(\.\d+)?$/.test(raw)) {
            throw new Error("INVALID_PRODUCT_PRICE");
        }
    }

    const price = Number(raw);

    if (
        !Number.isFinite(price) ||
        price < 0 ||
        price > 9999999999999.99
    ) {
        throw new Error("INVALID_PRODUCT_PRICE");
    }

    return price;
}


// =====================================================
// URL VALIDATION
// =====================================================

function validHttpUrl(value, errorCode, required = false) {
    if (value === undefined || value === null || value === "") {
        if (required) throw new Error(errorCode);
        return null;
    }

    let parsed;

    try {
        parsed = new URL(String(value).trim());
    } catch {
        throw new Error(errorCode);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(errorCode);
    }

    return parsed.toString();
}

// =====================================================
// PRODUCT NORMALIZATION
// =====================================================


function normalizeProductRow(row = {}) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("INVALID_PRODUCT_IMPORT_ROW");
    }

    const data = normalizeRow(row);

    const productId = cleanText(
    pick(data, "productId", "product_id"),
    100,
    "productId"
    );

    const skuId = cleanText(
        pick(data, "skuId", "sku_id"),
        100,
        "skuId"
    );

    const title = cleanText(
        pick(data, "title", "productName", "product_name"),
        500,
        "title"
    );

    const shortDescription = cleanText(
        pick(data, "shortDescription", "short_description"),
        2000,
        "shortDescription"
    );

    const rawCurrency = cleanText(
        pick(data, "currency"),
        10,
        "currency"
    );

    const currency = rawCurrency
        ? rawCurrency.toUpperCase()
        : "VND";

    const rawPrice = pick(data, "price");

    const rawImage = pick(
        data,
        "image",
        "imageUrl",
        "image_url"
    );

    const rawAffiliateLink = pick(
        data,
        "affiliateLink",
        "affiliate_link"
    );

    const rawFinalUrl = pick(
        data,
        "finalUrl",
        "final_url"
    );

    if (!productId) {
        throw new Error("INVALID_EXTERNAL_PRODUCT_ID");
    }

    if (productId.length > 100) {
        throw new Error("INVALID_EXTERNAL_PRODUCT_ID");
    }

    if (skuId && skuId.length > 100) {
        throw new Error("INVALID_EXTERNAL_SKU_ID");
    }

    const result = {
        productId,
        skuId: skuId || "",
        title
    };

    if (rawCurrency) {
        result.currency = currency;
    }

    if (shortDescription !== null) {
        result.shortDescription = shortDescription;
    }

    if (rawPrice !== null && rawPrice !== "") {
        result.price = parsePrice(rawPrice, currency);
    }

    if (rawImage !== null && rawImage !== "") {
        result.imageUrl = validHttpUrl(
            rawImage,
            "INVALID_PRODUCT_IMAGE_URL"
        );
    }

    if (rawAffiliateLink !== null && rawAffiliateLink !== "") {
        result.affiliateLink = validHttpUrl(
            rawAffiliateLink,
            "INVALID_AFFILIATE_LINK"
        );
    }

    if (rawFinalUrl !== null && rawFinalUrl !== "") {
        result.finalUrl = validHttpUrl(
            rawFinalUrl,
            "INVALID_FINAL_URL"
        );
    }

    return result;
}


// =====================================================
// NETWORK
// =====================================================

async function resolveNetwork(networkValue) {
    const value = String(networkValue || "lazada").trim();

    if (!value) {
        throw new Error("AFFILIATE_NETWORK_REQUIRED");
    }

    const numericId = /^\d+$/.test(value)
        ? Number(value)
        : -1;

    const [rows] = await db.execute(
        `SELECT id, code, name
         FROM affiliate_networks
         WHERE (id = ? OR code = ?)
           AND status = 'active'
         LIMIT 1`,
        [numericId, value]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_NETWORK_NOT_FOUND");
    }

    return rows[0];
}

// =====================================================
// EXISTING PRODUCT
// =====================================================

async function findExistingProduct(networkId, product) {
    const [rows] = await db.execute(
        `SELECT id, product_id, sku_id, title, price,
                currency, image_url, affiliate_link, final_url
         FROM affiliate_products
         WHERE network_id = ?
           AND product_id = ?
           AND sku_id = ?
         LIMIT 1`,
        [
            networkId,
            product.productId,
            product.skuId
        ]
    );

    return rows.length ? rows[0] : null;
}

// =====================================================
// ROW VALIDATION
// =====================================================

function validateProductData(product, isExisting) {
    if (!product.title && !isExisting) {
        throw new Error("INVALID_PRODUCT_TITLE");
    }

    if (!product.affiliateLink && !isExisting) {
        throw new Error("INVALID_AFFILIATE_LINK");
    }
}

// =====================================================
// PREVIEW
// =====================================================


async function previewProductsImport(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
    }

    if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error("AFFILIATE_IMPORT_TOO_MANY_ROWS");
    }

    const network = await resolveNetwork(
        options.networkCode || options.networkId || "lazada"
    );

    const seen = new Set();

    const result = {
        success: true,
        network: {
            id: network.id,
            code: network.code,
            name: network.name
        },
        summary: {
            totalRows: rows.length,
            newProducts: 0,
            newSkus: 0,
            updated: 0,
            failed: 0
        },
        rows: []
    };

    for (let index = 0; index < rows.length; index++) {
        try {
            const product = normalizeProductRow(rows[index]);

            const identity = [
                network.id,
                product.productId,
                product.skuId
            ].join("|");

            if (seen.has(identity)) {
                throw new Error("AFFILIATE_IMPORT_DUPLICATE_ROW");
            }

            const existing = await findExistingProduct(
                network.id,
                product
            );

            validateProductData(product, Boolean(existing));

            seen.add(identity);

            const action = existing ? "update" : "create";

            if (existing) {
                result.summary.updated++;
            } else {
                const [productRows] = await db.execute(
                    `SELECT id
                     FROM affiliate_products
                     WHERE network_id = ?
                       AND product_id = ?
                     LIMIT 1`,
                    [network.id, product.productId]
                );

                if (productRows.length) {
                    result.summary.newSkus++;
                } else {
                    result.summary.newProducts++;
                }
            }

            result.rows.push({
                row: index + 1,
                action,
                productId: product.productId,
                skuId: product.skuId,
                title: product.title,
                existingId: existing ? existing.id : null,
                price: product.price ?? existing?.price ?? null,
                currency: product.currency || existing?.currency || "VND",
                valid: true
            });
        } catch (error) {
            result.summary.failed++;

            result.rows.push({
                row: index + 1,
                valid: false,
                action: "failed",
                code: error.message || "AFFILIATE_IMPORT_ROW_FAILED",
                field: error.field || null,
                actualLength: error.actualLength || null,
                maxLength: error.maxLength || null
            });
        }
    }

    return result;
}

// =====================================================
// SYNC LOG
// =====================================================

async function createSyncLog(data) {
    const [result] = await db.execute(
        `INSERT INTO affiliate_sync_logs (
            network_id,
            sync_type,
            data_type,
            status,
            total_rows,
            created_by,
            started_at
        ) VALUES (?, ?, 'products', 'running', ?, ?, NOW())`,
        [
            data.networkId,
            data.syncType,
            data.totalRows,
            data.createdBy || null
        ]
    );

    return result.insertId;
}

async function finishSyncLog(syncId, data) {
    await db.execute(
        `UPDATE affiliate_sync_logs
         SET status = ?,
             success_rows = ?,
             failed_rows = ?,
             error_message = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [
            data.status,
            data.successRows,
            data.failedRows,
            data.errorMessage || null,
            syncId
        ]
    );
}

// =====================================================
// COMMIT
// =====================================================


async function commitProductsImport(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
    }

    if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error("AFFILIATE_IMPORT_TOO_MANY_ROWS");
    }

    const syncType = options.syncType || "csv_import";

    if (!ALLOWED_SYNC_TYPES.includes(syncType)) {
        throw new Error("INVALID_AFFILIATE_SYNC_TYPE");
    }

    const network = await resolveNetwork(
        options.networkCode || options.networkId || "lazada"
    );

    const syncId = await createSyncLog({
        networkId: network.id,
        syncType,
        totalRows: rows.length,
        createdBy: options.createdBy
    });

    const result = {
        success: true,
        syncId,
        network: {
            id: network.id,
            code: network.code,
            name: network.name
        },
        summary: {
            totalRows: rows.length,
            newProducts: 0,
            newSkus: 0,
            updated: 0,
            skipped: 0,
            failed: 0
        },
        errors: []
    };

    const seen = new Set();

    try {
        for (let index = 0; index < rows.length; index++) {
            try {
                const product = normalizeProductRow(rows[index]);

                const identity = [
                    network.id,
                    product.productId,
                    product.skuId
                ].join("|");

                if (seen.has(identity)) {
                    throw new Error("AFFILIATE_IMPORT_DUPLICATE_ROW");
                }

                const existing = await findExistingProduct(
                    network.id,
                    product
                );

                validateProductData(product, Boolean(existing));

                seen.add(identity);

                if (existing) {
                    const updateData = {};

                    const updateFields = [
                        "title",
                        "shortDescription",
                        "price",
                        "currency",
                        "imageUrl",
                        "affiliateLink",
                        "finalUrl"
                    ];

                    for (const field of updateFields) {
                        if (
                            Object.prototype.hasOwnProperty.call(product, field) &&
                            product[field] !== null &&
                            product[field] !== undefined &&
                            product[field] !== ""
                        ) {
                            updateData[field] = product[field];
                        }
                    }

                    if (Object.keys(updateData).length) {
                        await productService.updateProduct(
                            existing.id,
                            updateData,
                            options.createdBy,
                            options.audit || {}
                        );

                        result.summary.updated++;
                    } else {
                        result.summary.skipped++;
                    }
                } else {
                    const [productRows] = await db.execute(
                        `SELECT id
                         FROM affiliate_products
                         WHERE network_id = ?
                           AND product_id = ?
                         LIMIT 1`,
                        [network.id, product.productId]
                    );

                    await productService.createProduct(
                        {
                            ...product,
                            currency: product.currency || "VND",
                            networkId: network.id,
                            sourceType: "import",
                            status: options.defaultStatus || "draft",
                            categoryId: options.categoryId || null
                        },
                        options.createdBy,
                        options.audit || {}
                    );

                    if (productRows.length) {
                        result.summary.newSkus++;
                    } else {
                        result.summary.newProducts++;
                    }
                }
            } catch (error) {
                result.summary.failed++;

                result.errors.push({
                    row: index + 1,
                    code: error.message === "AFFILIATE_PRODUCT_ALREADY_EXISTS"
                        ? "AFFILIATE_IMPORT_DUPLICATE_PRODUCT"
                        : error.message || "AFFILIATE_IMPORT_ROW_FAILED"
                });
            }
        }

        const successful =
            result.summary.newProducts +
            result.summary.newSkus +
            result.summary.updated +
            result.summary.skipped;

        const failed = result.summary.failed;

        const status = failed === 0
            ? "success"
            : successful === 0
                ? "failed"
                : "partial";

        await finishSyncLog(syncId, {
            status,
            successRows: successful,
            failedRows: failed,
            errorMessage: result.errors.length
                ? JSON.stringify(result.errors).slice(0, 5000)
                : null
        });

        return result;
            } catch (error) {
            try {
                await finishSyncLog(syncId, {
                    status: "failed",
                    successRows: 0,
                    failedRows: rows.length,
                    errorMessage: String(
                        error.message || error
                    ).slice(0, 5000)
                });
            } catch (logError) {
                error.syncLogError = logError.message || String(logError);
            }

            throw error;
        }
}


module.exports = {
    normalizeProductRow,
    previewProductsImport,
    commitProductsImport
};
