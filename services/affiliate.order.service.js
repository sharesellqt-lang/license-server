
"use strict";

const crypto = require("crypto");
const db = require("../db");

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

function text(value, maxLength = 500) {
    if (value == null) return null;

    return String(value).trim().slice(0, maxLength) || null;
}

function decimal(value) {
    if (value == null || value === "") return null;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    let raw = String(value)
        .trim()
        .replace(/[^\d,.-]/g, "");

    if (!raw) return null;

    raw = raw.replace(/,/g, "");

    const number = Number(raw);

    return Number.isFinite(number) ? number : null;
}

function dateValue(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? null
            : value.toISOString().slice(0, 19).replace("T", " ");
    }

    const raw = String(value).trim();

    if (!raw) return null;

    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) return null;

    return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeOrder(row) {
    const data = normalizeRow(row);

    const checkoutId = text(pick(data, "Check Out ID"), 150);
    const skuOrderId = text(pick(data, "Sku Order ID"), 150);
    const subOrderId = text(pick(data, "Sub Order ID"), 150);

    const productId = text(pick(data, "Product ID"), 100);
    const skuId = text(pick(data, "SKU"), 150);

    const conversionTime = dateValue(
        pick(data, "Conversion Time")
    );

    if (!subOrderId && !skuOrderId && !checkoutId) {
        throw new Error("AFFILIATE_ORDER_IDENTIFIER_REQUIRED");
    }

        const fallbackKey = "fallback:" + crypto.createHash("sha256")
        .update([
            checkoutId || "",
            skuOrderId || "",
            productId || "",
            skuId || "",
            conversionTime || ""
        ].join("|"))
        .digest("hex");
    return {
        externalCheckoutId: checkoutId,
        externalSubOrderId: subOrderId || fallbackKey,
        fallbackKey,
        productExternalId: productId,
        skuExternalId: skuId,

        productName: text(
            pick(data, "Product Name"),
            500
        ),

        orderStatus: text(pick(data, "Status"), 100),
        platform: text(pick(data, "Platform"), 100),
        country: text(pick(data, "Country"), 100),

        conversionTime,
        fulfilledTime: dateValue(pick(data, "Fulfilled Time")),
        deliveredTime: dateValue(pick(data, "Delivered Time")),
        returnedTime: dateValue(pick(data, "Returned Time")),

        orderAmount: decimal(pick(data, "Order Amount")),
        adjustment: decimal(pick(data, "Adjustment")),
        currency: text(pick(data, "Currency"), 10) || "VND",
        commissionRate: decimal(pick(data, "Commission Rate")),
        payout: decimal(pick(data, "Payout")),

        validity: text(pick(data, "Validity"), 100),
        paymentStatus: text(pick(data, "Payment Status"), 100),
        paymentAdviceId: text(pick(data, "Payment Advice ID"), 150),
        paymentBillPeriod: text(pick(data, "Payment Bill Period"), 100),

        attribution: text(pick(data, "Attribution"), 150),
        affSubId: text(pick(data, "Aff Sub ID"), 255),

        subId1: text(pick(data, "Sub ID 1"), 255),
        subId2: text(pick(data, "Sub ID 2"), 255),
        subId3: text(pick(data, "Sub ID 3"), 255),
        subId4: text(pick(data, "Sub ID 4"), 255),
        subId5: text(pick(data, "Sub ID 5"), 255),
        subId6: text(pick(data, "Sub ID 6"), 255),

        rawData: row
    };
}

async function resolveNetwork(conn, networkCode = "lazada") {
    const [rows] = await conn.execute(
        `SELECT id
         FROM affiliate_networks
         WHERE code = ?
           AND status = 'active'
         LIMIT 1`,
        [networkCode]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_NETWORK_NOT_FOUND");
    }

    return rows[0].id;
}

async function findExistingOrder(conn, networkId, order) {
    // Ưu tiên mã Sub Order ID chính thức.
    if (!order.externalSubOrderId.startsWith("fallback:")) {
        const [rows] = await conn.execute(
            `SELECT id
             FROM affiliate_orders
             WHERE network_id = ?
               AND external_sub_order_id = ?
             LIMIT 1
             FOR UPDATE`,
            [networkId, order.externalSubOrderId]
        );

        if (rows.length) return rows[0].id;
    }

    // Tìm đơn cũ được lưu bằng fallback key.
    const [fallbackRows] = await conn.execute(
        `SELECT id
         FROM affiliate_orders
         WHERE network_id = ?
           AND external_sub_order_id = ?
         LIMIT 1
         FOR UPDATE`,
        [networkId, order.fallbackKey]
    );

    return fallbackRows.length ? fallbackRows[0].id : null;
}

async function importConversions(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error("AFFILIATE_IMPORT_DATA_REQUIRED");
    }

    const networkCode = options.networkCode || "lazada";
    const conn = await db.getConnection();

    const result = {
        total: rows.length,
        imported: 0,
        updated: 0,
        failed: 0,
        errors: []
    };

    const orderIds = [];

    try {
        await conn.beginTransaction();

        const networkId = await resolveNetwork(conn, networkCode);

        for (let index = 0; index < rows.length; index++) {
            try {
                const order = normalizeOrder(rows[index]);

                const existingId = await findExistingOrder(
                    conn,
                    networkId,
                    order
                );

                const values = [
                    order.externalCheckoutId,
                    order.externalSubOrderId,
                    order.productExternalId,
                    order.skuExternalId,
                    order.productName,
                    order.orderStatus,
                    order.platform,
                    order.country,
                    order.conversionTime,
                    order.fulfilledTime,
                    order.deliveredTime,
                    order.returnedTime,
                    order.orderAmount,
                    order.adjustment,
                    order.currency,
                    order.commissionRate,
                    order.payout,
                    order.validity,
                    order.paymentStatus,
                    order.paymentAdviceId,
                    order.paymentBillPeriod,
                    order.attribution,
                    order.affSubId,
                    order.subId1,
                    order.subId2,
                    order.subId3,
                    order.subId4,
                    order.subId5,
                    order.subId6,
                    JSON.stringify(order.rawData)
                ];

                if (existingId) {
                    await conn.execute(
                        `UPDATE affiliate_orders SET
                            external_checkout_id = ?,
                            external_sub_order_id = ?,
                            product_external_id = ?,
                            sku_external_id = ?,
                            product_name = ?,
                            order_status = ?,
                            platform = ?,
                            country = ?,
                            conversion_time = ?,
                            fulfilled_time = ?,
                            delivered_time = ?,
                            returned_time = ?,
                            order_amount = ?,
                            adjustment = ?,
                            currency = ?,
                            commission_rate = ?,
                            payout = ?,
                            validity = ?,
                            payment_status = ?,
                            payment_advice_id = ?,
                            payment_bill_period = ?,
                            attribution = ?,
                            aff_sub_id = ?,
                            sub_id_1 = ?,
                            sub_id_2 = ?,
                            sub_id_3 = ?,
                            sub_id_4 = ?,
                            sub_id_5 = ?,
                            sub_id_6 = ?,
                            raw_data = ?,
                            imported_at = NOW(),
                            updated_at = NOW()
                         WHERE id = ?`,
                        [...values, existingId]
                    );

                    orderIds.push(Number(existingId));
                    result.updated++;
                } else {
                    const [insertResult] = await conn.execute(
                        `INSERT INTO affiliate_orders (
                            network_id,
                            external_checkout_id,
                            external_sub_order_id,
                            product_external_id,
                            sku_external_id,
                            product_name,
                            order_status,
                            platform,
                            country,
                            conversion_time,
                            fulfilled_time,
                            delivered_time,
                            returned_time,
                            order_amount,
                            adjustment,
                            currency,
                            commission_rate,
                            payout,
                            validity,
                            payment_status,
                            payment_advice_id,
                            payment_bill_period,
                            attribution,
                            aff_sub_id,
                            sub_id_1,
                            sub_id_2,
                            sub_id_3,
                            sub_id_4,
                            sub_id_5,
                            sub_id_6,
                            raw_data,
                            attribution_status,
                            imported_at
                        ) VALUES (
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, 'pending', NOW()
                        )`,
                        [networkId, ...values]
                    );

                    orderIds.push(Number(insertResult.insertId));
                    result.imported++;
                }
            } catch (error) {
                result.failed++;

                result.errors.push({
                    row: index + 1,
                    code: error.message || "AFFILIATE_IMPORT_ROW_FAILED"
                });
            }
        }

        await conn.commit();

        return {
            ...result,
            orderIds: [...new Set(orderIds)]
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    normalizeOrder,
    importConversions
};
