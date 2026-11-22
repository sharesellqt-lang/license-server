
"use strict";

const db = require("../db");

const orderService = require("./affiliate.order.service");
const attributionService = require("./affiliate.attribution.service");
const commissionService = require("./affiliate.commission.service");

const PENDING_ATTRIBUTION_ERRORS = [
    "AFFILIATE_SUB_ID_1_MISSING",
    "AFFILIATE_CLICK_NOT_FOUND",
    "AFFILIATE_CLICK_TIME_INVALID"
];

const PENDING_COMMISSION_ERRORS = [
    "AFFILIATE_ORDER_NOT_ATTRIBUTED",
    "AFFILIATE_COMMISSION_NOT_CONFIRMED"
];

const ALLOWED_SYNC_TYPES = [
    "manual_import",
    "csv_import",
    "excel_import",
    "api_sync"
];

function positiveId(value, error = "INVALID_AFFILIATE_NETWORK_ID") {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(error);
    }

    return id;
}

async function resolveNetwork(networkValue) {
    if (
        networkValue === undefined ||
        networkValue === null ||
        String(networkValue).trim() === ""
    ) {
        throw new Error("AFFILIATE_NETWORK_REQUIRED");
    }

    const value = String(networkValue).trim();
    const numericId = /^\d+$/.test(value)
        ? positiveId(value)
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
        ) VALUES (?, ?, 'conversions', 'running', ?, ?, NOW())`,
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

function normalizeOrderIds(value) {
    if (!Array.isArray(value)) return [];

    return [
        ...new Set(
            value
                .map(Number)
                .filter(id =>
                    Number.isSafeInteger(id) && id > 0
                )
        )
    ];
}

async function getOrderForAttribution(orderId, networkId) {
    const [rows] = await db.execute(
        `SELECT
            id,
            network_id,
            sub_id_1,
            click_id,
            attribution_status
         FROM affiliate_orders
         WHERE id = ?
           AND network_id = ?
         LIMIT 1`,
        [orderId, networkId]
    );

    if (!rows.length) {
        throw new Error("AFFILIATE_ORDER_NOT_FOUND");
    }

    return rows[0];
}

async function importConversionReport(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error("AFFILIATE_REPORT_EMPTY");
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

    try {
        const importResult = await orderService.importConversions(rows, {
            networkCode: network.code
        });

        const imported = Number(importResult.imported || 0);
        const updated = Number(importResult.updated || 0);
        const importFailed = Number(importResult.failed || 0);

        const orderIds = normalizeOrderIds(importResult.orderIds);

        let attributionVerified = 0;
        let attributionPending = 0;
        let attributionFailed = 0;

        let commissionProcessed = 0;
        let commissionPending = 0;
        let commissionFailed = 0;

        const attributionErrors = [];
        const commissionErrors = [];

        for (const orderId of orderIds) {
            // 1. Xác minh attribution bằng Sub ID 1.
            try {
                const order = await getOrderForAttribution(
                    orderId,
                    network.id
                );

                const clickCode = String(
                    order.sub_id_1 || ""
                ).trim().toLowerCase();

                if (!clickCode) {
                    throw new Error("AFFILIATE_SUB_ID_1_MISSING");
                }

                if (!/^[a-f0-9]{32}$/.test(clickCode)) {
                    throw new Error("INVALID_AFFILIATE_CLICK_CODE");
                }

                const attribution = await attributionService.matchOrderToClick(
                    orderId,
                    clickCode,
                    options.createdBy || null,
                    {
                        ipAddress:
                            options.audit?.ipAddress ||
                            options.ipAddress ||
                            null,
                        userAgent:
                            options.audit?.userAgent ||
                            options.userAgent ||
                            null
                    }
                );

                if (
                    !attribution ||
                    attribution.attributionStatus !== "verified"
                ) {
                    throw new Error("AFFILIATE_ATTRIBUTION_NOT_VERIFIED");
                }

                attributionVerified++;
            } catch (error) {
                const code = error.message ||
                    "AFFILIATE_ATTRIBUTION_FAILED";

                if (PENDING_ATTRIBUTION_ERRORS.includes(code)) {
                    attributionPending++;
                } else {
                    attributionFailed++;
                    attributionErrors.push({
                        orderId,
                        code
                    });
                }

                // Không xét commission nếu attribution chưa verified.
                continue;
            }

            // 2. Xử lý commission sau khi attribution verified.
            try {
                await commissionService.processOrderCommission(orderId);
                commissionProcessed++;
            } catch (error) {
                const code = error.message ||
                    "AFFILIATE_COMMISSION_PROCESS_FAILED";

                if (PENDING_COMMISSION_ERRORS.includes(code)) {
                    commissionPending++;
                } else {
                    commissionFailed++;
                    commissionErrors.push({
                        orderId,
                        code
                    });
                }
            }
        }

        const importErrors = Array.isArray(importResult.errors)
            ? importResult.errors
            : [];

        const errors = [
            ...importErrors,
            ...attributionErrors,
            ...commissionErrors
        ];

        const failedRows =
            importFailed +
            attributionFailed +
            commissionFailed;

        const successRows = Math.max(
            0,
            imported +
            updated -
            attributionPending -
            attributionFailed -
            commissionPending -
            commissionFailed
        );

        const syncStatus = failedRows > 0
            ? "partial"
            : "success";

        await finishSyncLog(syncId, {
            status: syncStatus,
            successRows,
            failedRows,
            errorMessage: errors.length
                ? JSON.stringify(errors).slice(0, 5000)
                : null
        });

        return {
            success: true,
            syncId,
            network: {
                id: network.id,
                code: network.code,
                name: network.name
            },
            summary: {
                totalRows: rows.length,
                imported,
                updated,
                failed: importFailed,
                attributionVerified,
                attributionPending,
                attributionFailed,
                commissionProcessed,
                commissionPending,
                commissionFailed
            },
            errors
        };
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
            error.syncLogError = logError.message;
        }

        throw error;
    }
}

module.exports = {
    importConversionReport
};
