
"use strict";

const db = require("../db");

function positiveId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("INVALID_USER_ID");
    }
    return id;
}

async function getSellerDashboard(userId) {
    userId = positiveId(userId);

    const [sellers] = await db.execute(
        `SELECT id, user_id, display_name, status
         FROM marketplace_sellers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (!sellers.length) throw new Error("SELLER_NOT_FOUND");

    const seller = sellers[0];
    const sellerId = seller.id;

    const [
        [productRows],
        [orderRows],
        [commissionRows],
        [payoutRows],
        [taskRows],
        [activityRows]
    ] = await Promise.all([
        // PRODUCTS
        db.execute(
            `SELECT
                COUNT(*) AS total_products,
                COALESCE(SUM(status = 'published'), 0) AS active_products,
                COALESCE(SUM(status = 'paused'), 0) AS paused_products,
                COALESCE(SUM(status IN ('pending_review', 'under_review')), 0) AS pending_products,
                COALESCE(SUM(status IN ('revision_required', 'rejected')), 0) AS products_need_revision
            FROM marketplace_products
            WHERE seller_id = ?`,
            [sellerId]
        ),

        // ORDERS: Seller được xác định qua order_items
        db.execute(
            `SELECT
                COUNT(DISTINCT oi.order_id) AS total_orders,
                SUM(
                    CASE
                        WHEN o.payment_status = 'paid'
                         AND o.order_status NOT IN ('cancelled', 'disputed', 'refunded')
                         AND (
                            d.id IS NULL
                            OR d.status = 'failed'
                         )
                        THEN 1 ELSE 0
                    END
                ) AS pending_deliveries,
                SUM(
                    CASE
                        WHEN o.payment_status = 'paid'
                         AND o.order_status NOT IN ('cancelled', 'disputed', 'refunded')
                         AND o.payment_status != 'partially_refunded'
                        THEN oi.line_total ELSE 0
                    END
                ) AS total_revenue
             FROM marketplace_order_items oi
             INNER JOIN marketplace_orders o ON o.id = oi.order_id
             LEFT JOIN marketplace_deliveries d ON d.order_item_id = oi.id
             WHERE oi.seller_id = ?`,
            [sellerId]
        ),

        // COMMISSIONS
        db.execute(
            `SELECT
                SUM(
                    CASE WHEN status = 'pending_protection'
                    THEN GREATEST(seller_amount - paid_amount - reversed_amount, 0)
                    ELSE 0 END
                ) AS pending_protection,
                SUM(
                    CASE WHEN status = 'available'
                    THEN GREATEST(seller_amount - paid_amount - reversed_amount, 0)
                    ELSE 0 END
                ) AS available_commission,
                SUM(paid_amount) AS total_paid
             FROM marketplace_commissions
             WHERE seller_id = ?
               AND seller_user_id = ?`,
            [sellerId, userId]
        ),

        // ACTIVE PAYOUTS
        db.execute(
            `SELECT COALESCE(SUM(pi.amount), 0) AS pending_payout
             FROM marketplace_payout_items pi
             INNER JOIN marketplace_payout_requests pr
                ON pr.id = pi.payout_request_id
             WHERE pr.seller_id = ?
               AND pr.seller_user_id = ?
               AND pr.status IN ('pending', 'under_review', 'approved', 'processing')
               AND pi.status IN ('requested', 'approved')`,
            [sellerId, userId]
        ),

        // SELLER TASKS
        db.execute(
            `SELECT
                (
                    SELECT COUNT(*)
                    FROM marketplace_support_tickets
                    WHERE seller_user_id = ?
                      AND status IN ('open', 'waiting_seller')
                ) AS active_support_tickets,
                (
                    SELECT COUNT(*)
                    FROM marketplace_commission_holds h
                    INNER JOIN marketplace_commissions c
                        ON c.id = h.commission_id
                    WHERE c.seller_id = ?
                      AND c.seller_user_id = ?
                      AND h.status = 'active'
                ) AS active_commission_holds`,
            [userId, sellerId, userId]
        ),

        // RECENT ACTIVITY
        db.execute(
            `SELECT * FROM (
                SELECT
                    'product' AS type,
                    title AS title,
                    status AS status,
                    updated_at AS created_at
                FROM marketplace_products
                WHERE seller_id = ?

                UNION ALL

                SELECT
                    'delivery' AS type,
                    CONCAT('Đơn hàng #', oi.order_id) AS title,
                    d.status AS status,
                    d.updated_at AS created_at
                FROM marketplace_deliveries d
                INNER JOIN marketplace_order_items oi
                    ON oi.id = d.order_item_id
                WHERE oi.seller_id = ?

                UNION ALL

                SELECT
                    'support' AS type,
                    subject AS title,
                    status AS status,
                    updated_at AS created_at
                FROM marketplace_support_tickets
                WHERE seller_user_id = ?

                UNION ALL

                SELECT
                    'payout' AS type,
                    request_code AS title,
                    status AS status,
                    updated_at AS created_at
                FROM marketplace_payout_requests
                WHERE seller_id = ?
                  AND seller_user_id = ?
            ) AS activities
            ORDER BY created_at DESC
            LIMIT 10`,
            [sellerId, sellerId, userId, sellerId, userId]
        )
    ]);

    const products = productRows[0] || {};
    const orders = orderRows[0] || {};
    const commissions = commissionRows[0] || {};
    const payouts = payoutRows[0] || {};
    const tasks = taskRows[0] || {};

    const number = value => Number(value || 0);

    return {
        seller: {
            id: seller.id,
            userId: seller.user_id,
            displayName: seller.display_name,
            status: seller.status
        },
        stats: {
            totalProducts: number(products.total_products),
            activeProducts: number(products.active_products),
            pendingProducts: number(products.pending_products),
            totalOrders: number(orders.total_orders),
            pendingDeliveries: number(orders.pending_deliveries),
            totalRevenue: number(orders.total_revenue),
            pendingProtection: number(commissions.pending_protection),
            availableCommission: number(commissions.available_commission),
            pendingPayout: number(payouts.pending_payout),
            totalPaid: number(commissions.total_paid),
            pausedProducts: number(products.paused_products),
        },
        tasks: {
            productsNeedRevision: number(products.products_need_revision),
            ordersNeedDelivery: number(orders.pending_deliveries),
            activeSupportTickets: number(tasks.active_support_tickets),
            activeCommissionHolds: number(tasks.active_commission_holds)
        },
        recentActivity: activityRows.map(row => ({
            type: row.type,
            title: row.title,
            status: row.status,
            createdAt: row.created_at
        }))
    };
}

module.exports = { getSellerDashboard };
