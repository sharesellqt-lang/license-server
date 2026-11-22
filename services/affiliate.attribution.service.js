
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

    actorUserId = actorUserId == null || actorUserId === ""
        ? null
        : positiveId(actorUserId, "INVALID_ACTOR_USER_ID");

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Lock đơn hàng để tránh attribution đồng thời.
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

        // 2. Sub ID 1 phải trùng clickCode.
        if (
            String(order.sub_id_1 || "").trim().toLowerCase() !== clickCode
        ) {
            throw new Error("AFFILIATE_SUB_ID_1_MISMATCH");
        }

        // 3. Tìm và lock click tương ứng.
        const [clickRows] = await conn.execute(
            `SELECT
                c.*,
                p.product_id AS external_product_id,
                p.sku_id AS external_sku_id,
                p.status AS product_status,
                n.status AS network_status,
                n.code AS network_code,
                CASE
                    WHEN ? IS NULL THEN 0
                    WHEN c.clicked_at <= ? THEN 1
                    ELSE 0
                END AS click_time_valid
             FROM affiliate_clicks c
             JOIN affiliate_products p
                ON p.id = c.product_id
             JOIN affiliate_networks n
                ON n.id = c.network_id
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

        // 4. Kiểm tra network.
        if (
            String(order.network_id) !== String(click.network_id)
        ) {
            throw new Error("AFFILIATE_NETWORK_MISMATCH");
        }

        if (
            click.network_code !== "lazada" ||
            click.network_status !== "active"
        ) {
            throw new Error("AFFILIATE_NETWORK_INACTIVE");
        }

        // 5. Kiểm tra sản phẩm và SKU.
        if (click.product_status !== "active") {
            throw new Error("AFFILIATE_PRODUCT_INACTIVE");
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

        // 6. Click phải xảy ra trước hoặc tại thời điểm conversion.
        if (!click.click_time_valid) {
            throw new Error("AFFILIATE_CLICK_TIME_INVALID");
        }

        // 7. Không cho phép đổi click đã được gán.
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

        // 8. Cập nhật attribution.
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

        // 9. Ghi audit trong cùng transaction.
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
                attributionStatus: "verified",
                source: actorUserId ? "admin" : "system"
            },
            ipAddress: audit.ipAddress ?? null,
            userAgent: audit.userAgent ?? null
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
