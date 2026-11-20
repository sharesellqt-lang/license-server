
"use strict";

const db = require("../db");
const { writeAudit } = require("./contributor.audit.service");

function positiveId(value, error = "INVALID_AFFILIATE_ORDER_ID") {
    const id = String(value ?? "").trim();

    if (!/^[1-9]\d*$/.test(id)) {
        throw new Error(error);
    }

    return id;
}

function normalizeClickCode(value) {
    const code = String(value || "").trim();

    if (!/^[a-f0-9]{32}$/i.test(code)) {
        throw new Error("INVALID_AFFILIATE_CLICK_CODE");
    }

    return code.toLowerCase();
}

async function matchOrderToClick(orderId, clickCode, actorUserId, audit = {}) {
    orderId = positiveId(orderId);
    clickCode = normalizeClickCode(clickCode);
    actorUserId = positiveId(actorUserId, "INVALID_ACTOR_USER_ID");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [orderRows] = await conn.execute(
            `SELECT *
             FROM affiliate_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderId]
        );

        if (!orderRows.length) {
            throw new Error("AFFILIATE_ORDER_NOT_FOUND");
        }

        const order = orderRows[0];

        const [clickRows] = await conn.execute(
            `SELECT
                c.*,
                p.product_id AS external_product_id,
                p.sku_id AS external_sku_id,
                CASE
                    WHEN ? IS NULL THEN 0
                    WHEN c.clicked_at <= ? THEN 1
                    ELSE 0
                END AS click_time_valid
             FROM affiliate_clicks c
             JOIN affiliate_products p
                ON p.id = c.product_id
             WHERE c.click_code = ?
             LIMIT 1
             FOR UPDATE`,
            [
                order.conversion_time,
                order.conversion_time,
                clickCode
            ]
        );

        if (!clickRows.length) {
            throw new Error("AFFILIATE_CLICK_NOT_FOUND");
        }

        const click = clickRows[0];

        if (String(order.network_id) !== String(click.network_id)) {
            throw new Error("AFFILIATE_NETWORK_MISMATCH");
        }

        if (
            order.product_external_id &&
            String(order.product_external_id) !==
                String(click.external_product_id)
        ) {
            throw new Error("AFFILIATE_PRODUCT_MISMATCH");
        }

        if (
            order.sku_external_id &&
            click.external_sku_id &&
            String(order.sku_external_id) !==
                String(click.external_sku_id)
        ) {
            throw new Error("AFFILIATE_SKU_MISMATCH");
        }

        if (!click.click_time_valid) {
            throw new Error("AFFILIATE_CLICK_TIME_INVALID");
        }

        if (order.click_id) {
            if (String(order.click_id) !== String(click.id)) {
                throw new Error("AFFILIATE_ORDER_ALREADY_ATTRIBUTED");
            }

            if (order.attribution_status === "verified") {
                await conn.commit();

                return {
                    success: true,
                    alreadyVerified: true,
                    orderId: String(order.id),
                    clickId: String(click.id),
                    userId: String(click.user_id),
                    attributionStatus: "verified"
                };
            }
        }

        if (click.attribution_status === "unmatched") {
            throw new Error("AFFILIATE_CLICK_NOT_ELIGIBLE");
        }

        await conn.execute(
            `UPDATE affiliate_orders
             SET click_id = ?,
                 attribution_status = 'verified',
                 updated_at = NOW()
             WHERE id = ?`,
            [click.id, order.id]
        );

        await conn.execute(
            `UPDATE affiliate_clicks
             SET attribution_status = 'verified'
             WHERE id = ?`,
            [click.id]
        );

        await writeAudit(conn, {
            actorUserId,
            targetUserId: click.user_id,
            action: "affiliate_order.attributed",
            entityType: "affiliate_order",
            entityId: order.id,
            oldData: {
                clickId: order.click_id,
                attributionStatus: order.attribution_status
            },
            newData: {
                clickId: click.id,
                clickCode: click.click_code,
                userId: click.user_id,
                attributionStatus: "verified"
            },
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent
        });

        await conn.commit();

        return {
            success: true,
            alreadyVerified: false,
            orderId: String(order.id),
            clickId: String(click.id),
            userId: String(click.user_id),
            attributionStatus: "verified"
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    matchOrderToClick
};
