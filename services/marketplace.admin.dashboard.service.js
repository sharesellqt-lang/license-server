
"use strict";

const db = require("../db");

function toNumber(value) {
    return Number(value || 0);
}

async function getMarketplaceAdminDashboard(options = {}) {
    const includeFinance = options.includeFinance === true;

    const [
        [sellerRows],
        [productRows],
        [orderRows],
        [revenueRows],
        [pendingRows],
        [supportRows],
        [payoutRows]
    ] = await Promise.all([
        db.execute(`
            SELECT COUNT(*) AS total
            FROM marketplace_sellers
            WHERE status = 'active'
        `),

        db.execute(`
            SELECT COUNT(*) AS total
            FROM marketplace_products
            WHERE status = 'published'
        `),

        db.execute(`
            SELECT COUNT(*) AS total
            FROM marketplace_orders
            WHERE order_status NOT IN ('cancelled', 'refunded')
        `),

        db.execute(`
            SELECT COALESCE(SUM(total_amount), 0) AS total
            FROM marketplace_orders
            WHERE payment_status IN ('paid', 'partially_refunded')
        `),

        db.execute(`
            SELECT
                (SELECT COUNT(*)
                 FROM marketplace_sellers
                 WHERE status = 'pending') AS sellers,

                (SELECT COUNT(*)
                 FROM marketplace_products
                 WHERE status IN ('pending_review', 'under_review')) AS products,

                (SELECT COUNT(*)
                 FROM marketplace_orders
                 WHERE payment_status = 'pending'
                   AND order_status = 'pending_payment') AS orders
        `),

        db.execute(`
            SELECT COUNT(*) AS total
            FROM marketplace_support_tickets
            WHERE status IN (
                'open',
                'waiting_seller',
                'waiting_buyer',
                'under_review'
            )
        `),

        db.execute(`
            SELECT COUNT(*) AS total
            FROM marketplace_payout_requests
            WHERE status IN ('pending', 'under_review', 'approved', 'processing')
        `)
    ]);

    let finance = {
        seller_commission_total: 0,
        platform_commission_total: 0,
        pending_protection: 0,
        available_commission: 0
    };

    if (includeFinance) {
        const [commissionRows] = await db.execute(`
            SELECT
                COALESCE(SUM(seller_amount), 0) AS seller_commission_total,
                COALESCE(SUM(platform_amount), 0) AS platform_commission_total,
                COALESCE(SUM(
                    CASE
                        WHEN status = 'pending_protection'
                        THEN seller_amount
                        ELSE 0
                    END
                ), 0) AS pending_protection,
                COALESCE(SUM(
                    CASE
                        WHEN status = 'available'
                        THEN seller_amount
                        ELSE 0
                    END
                ), 0) AS available_commission
            FROM marketplace_commissions
            WHERE status NOT IN ('reversed')
        `);

        const row = commissionRows[0] || {};

        finance = {
            seller_commission_total: toNumber(row.seller_commission_total),
            platform_commission_total: toNumber(row.platform_commission_total),
            pending_protection: toNumber(row.pending_protection),
            available_commission: toNumber(row.available_commission)
        };
    }

    const pending = pendingRows[0] || {};

    return {
        overview: {
            active_sellers: toNumber(sellerRows[0]?.total),
            published_products: toNumber(productRows[0]?.total),
            total_orders: toNumber(orderRows[0]?.total),
            total_revenue: toNumber(revenueRows[0]?.total)
        },
        pending: {
            sellers: toNumber(pending.sellers),
            products: toNumber(pending.products),
            orders: toNumber(pending.orders),
            support_tickets: toNumber(supportRows[0]?.total),
            payout_requests: toNumber(payoutRows[0]?.total)
        },
        finance,
        updated_at: new Date().toISOString()
    };
}

module.exports = {
    getMarketplaceAdminDashboard
};
