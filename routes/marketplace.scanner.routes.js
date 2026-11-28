"use strict";

const express = require("express");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const scannerService = require("../services/marketplace.scanner.service");

const router = express.Router();

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

function validId(value) {
    return /^\d+$/.test(String(value || "")) &&
        Number(value) > 0 &&
        Number.isSafeInteger(Number(value));
}

function verifyProvisionKey(req) {
    const expected = process.env.SCANNER_PROVISIONING_SECRET;
    const supplied = req.get("x-scanner-provision-key");

    if (!expected || !supplied) return false;

    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);

    return a.length === b.length &&
        crypto.timingSafeEqual(a, b);
}

// ========================================
// REGISTER SCANNER
// ========================================
// Chỉ Admin hoặc hệ thống provisioning
// có provisioning secret mới được đăng ký.
router.post(
    "/register",
    asyncHandler(async (req, res) => {
        if (!process.env.SCANNER_PROVISIONING_SECRET) {
            return res.status(503).json({
                success: false,
                error: "SCANNER_PROVISIONING_NOT_CONFIGURED"
            });
        }

        if (!verifyProvisionKey(req)) {
            return res.status(401).json({
                success: false,
                error: "INVALID_PROVISION_KEY"
            });
        }

        const result = await scannerService.registerScanner({
            scannerName: req.body.scannerName,
            scannerType: req.body.scannerType || "home",
            platform: req.body.platform || null,
            maxConcurrency: req.body.maxConcurrency || 1
        });

        return res.status(201).json({
            success: true,
            scanner: {
                id: result.scannerId,
                name: result.scannerName
            },
            token: result.token,
            warning: "TOKEN_SHOWN_ONCE_STORE_IT_SECURELY"
        });
    })
);

// ========================================
// WORKER AUTHENTICATION
// ========================================
async function scannerAuth(req, res, next) {
    try {
        const authorization = req.get("authorization") || "";
        const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);

        if (!match) {
            return res.status(401).json({
                success: false,
                error: "SCANNER_AUTH_REQUIRED"
            });
        }

        const scanner = await scannerService.authenticateScanner(
            match[1]
        );

        if (!scanner) {
            return res.status(401).json({
                success: false,
                error: "INVALID_SCANNER_TOKEN"
            });
        }

        req.scanner = scanner;
        next();

    } catch (err) {
        next(err);
    }
}

router.use(scannerAuth);

// ========================================
// HEARTBEAT
// ========================================
router.post(
    "/heartbeat",
    asyncHandler(async (req, res) => {
        await scannerService.heartbeat(
            req.scanner.id,
            req.body || {}
        );

        return res.json({
            success: true,
            scannerId: req.scanner.id,
            status: "online",
            serverTime: new Date().toISOString()
        });
    })
);

// ========================================
// CLAIM JOB
// ========================================
router.post(
    "/jobs/claim",
    asyncHandler(async (req, res) => {
        const job = await scannerService.claimJob(
            req.scanner.id
        );

        return res.json({
            success: true,
            job: job || null
        });
    })
);


router.post(
    "/jobs/:id/renew",
    asyncHandler(async (req, res) => {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_JOB_ID"
            });
        }

        const result = await scannerService.renewJob(
            req.scanner.id,
            Number(req.params.id)
        );

        return res.json(result);
    })
);

// ========================================
// DOWNLOAD FILE FOR SCANNING
// ========================================
router.get(
    "/jobs/:id/file",
    asyncHandler(async (req, res) => {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_JOB_ID"
            });
        }

        const object = await scannerService.getJobFile(
            req.scanner.id,
            Number(req.params.id)
        );

        res.status(200);
        res.setHeader(
            "Content-Type",
            object.contentType || "application/octet-stream"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="scan-${req.params.id}"`
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");

        if (object.contentLength != null) {
            res.setHeader(
                "Content-Length",
                String(object.contentLength)
            );
        }

        try {
            await pipeline(object.body, res);
        } catch (err) {
            console.error("[SCANNER FILE STREAM ERROR]", err.message);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: "SCANNER_FILE_STREAM_FAILED"
                });
            } else {
                res.destroy(err);
            }
        }
    })
);

// ========================================
// SUBMIT SCAN RESULT
// ========================================

router.post(
    "/jobs/:id/result",
    asyncHandler(async (req, res) => {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_JOB_ID"
            });
        }

        const result = await scannerService.completeJob(
            req.scanner.id,
            Number(req.params.id),
            {
                result: req.body.result,
                fileHash: req.body.fileHash,
                clamavVersion: req.body.clamavVersion,
                signatureVersion: req.body.signatureVersion,
                details: req.body.details
            }
        );

        return res.json(result);
    })
);

// ========================================
// REPORT SCAN ERROR
// ========================================
router.post(
    "/jobs/:id/fail",
    asyncHandler(async (req, res) => {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_JOB_ID"
            });
        }

        const result = await scannerService.failJob(
            req.scanner.id,
            Number(req.params.id),
            req.body.errorCode
        );

        return res.json(result);
    })
);

// ========================================
// ERROR HANDLER
// ========================================
router.use((err, req, res, next) => {
    console.error("[MARKETPLACE SCANNER ERROR]", err.message);

    
const knownErrors = {
    INVALID_SCANNER_CONFIG: 400,
    INVALID_SCANNER_CONCURRENCY: 400,
    INVALID_SCAN_CONFIG: 400,
    INVALID_SCAN_RESULT: 400,
    INVALID_SCAN_FILE_HASH: 400,
    SCANNER_NOT_AVAILABLE: 403,
    SCAN_JOB_NOT_AVAILABLE: 409,
    SCAN_RECORD_NOT_FOUND: 409,
    SCAN_FILE_HASH_MISSING: 409,
    SCAN_FILE_HASH_MISMATCH: 409
};


    const status = knownErrors[err.message] || 500;

    return res.status(status).json({
        success: false,
        error: knownErrors[err.message]
            ? err.message
            : "SCANNER_INTERNAL_ERROR"
    });
});

module.exports = router;