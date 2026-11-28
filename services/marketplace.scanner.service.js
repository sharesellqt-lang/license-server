
"use strict";

const crypto = require("crypto");
const db = require("../db");
const storageService = require("./marketplace.storage.service");

const LEASE_MINUTES = 10;
const RETRY_DELAY_MINUTES = 2;
const MAX_ERROR_LENGTH = 100;
const MAX_DETAILS_LENGTH = 10000;

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

function safeText(value, maxLength) {
    if (typeof value !== "string") return null;
    return value.trim().slice(0, maxLength) || null;
}

function validHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

// ========================================
// REGISTER SCANNER
// ========================================
async function registerScanner({
    scannerName,
    scannerType = "home",
    platform = null,
    maxConcurrency = 1
}) {
    const name = safeText(scannerName, 100);

    if (!name || !["home", "vps", "other"].includes(scannerType)) {
        throw new Error("INVALID_SCANNER_CONFIG");
    }

    const concurrency = Number(maxConcurrency);

    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
        throw new Error("INVALID_SCANNER_CONCURRENCY");
    }

    const token = generateToken();

    const [result] = await db.execute(
        `INSERT INTO marketplace_scanners
        (scanner_name, scanner_type, auth_token_hash,
         platform, max_concurrency, status)
        VALUES (?, ?, ?, ?, ?, 'registered')`,
        [
            name,
            scannerType,
            hashToken(token),
            safeText(platform, 50),
            concurrency
        ]
    );

    return {
        scannerId: result.insertId,
        scannerName: name,
        token
    };
}

// ========================================
// AUTHENTICATE SCANNER
// ========================================
async function authenticateScanner(token) {
    if (
        typeof token !== "string" ||
        !/^[a-f0-9]{64}$/i.test(token)
    ) {
        return null;
    }

    const [rows] = await db.execute(
        `SELECT id, scanner_name, scanner_type,
                status, max_concurrency
         FROM marketplace_scanners
         WHERE auth_token_hash = ?
         LIMIT 1`,
        [hashToken(token)]
    );

    const scanner = rows[0];

    if (!scanner || scanner.status === "disabled") {
        return null;
    }

    return scanner;
}

// ========================================
// HEARTBEAT
// ========================================
async function heartbeat(scannerId, data = {}) {
    const [result] = await db.execute(
        `UPDATE marketplace_scanners
         SET status = 'online',
             platform = COALESCE(?, platform),
             worker_version = COALESCE(?, worker_version),
             clamav_version = COALESCE(?, clamav_version),
             signature_version = COALESCE(?, signature_version),
             last_seen_at = NOW()
         WHERE id = ?
           AND status != 'disabled'`,
        [
            safeText(data.platform, 50),
            safeText(data.workerVersion, 50),
            safeText(data.clamavVersion, 100),
            safeText(data.signatureVersion, 100),
            scannerId
        ]
    );

    if (result.affectedRows !== 1) {
        throw new Error("SCANNER_NOT_AVAILABLE");
    }

    return { success: true };
}

// ========================================
// RECOVER EXPIRED JOBS
// Chỉ xử lý job đang processing đã hết lease.
// Không để generation cũ ghi đè trạng thái mới.
// ========================================
async function recoverExpiredJobs(conn) {
    const [expiredJobs] = await conn.execute(
        `SELECT id, storage_key, scan_generation,
                attempts, max_attempts
         FROM marketplace_file_scan_jobs
         WHERE status = 'processing'
           AND lease_expires_at <= NOW()
         ORDER BY id ASC
         LIMIT 100
         FOR UPDATE`
    );

    for (const job of expiredJobs) {
        const terminal =
            Number(job.attempts) >= Number(job.max_attempts);

        if (terminal) {
            await conn.execute(
                `UPDATE marketplace_file_scan_jobs
                 SET status = 'failed',
                     scanner_id = NULL,
                     completed_at = NOW(),
                     lease_expires_at = NULL,
                     last_error_code = 'MAX_ATTEMPTS_EXCEEDED'
                 WHERE id = ?
                   AND status = 'processing'`,
                [job.id]
            );

            // Chỉ cập nhật trạng thái nếu không có generation mới hơn.
            await conn.execute(
                `UPDATE marketplace_file_scans s
                 SET s.scan_status = 'error',
                     s.last_error_code = 'MAX_ATTEMPTS_EXCEEDED'
                 WHERE s.storage_key = ?
                   AND s.scan_status = 'pending'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM marketplace_file_scan_jobs newer
                       WHERE newer.storage_key = s.storage_key
                         AND newer.scan_generation > ?
                   )`,
                [job.storage_key, job.scan_generation]
            );
        } else {
            await conn.execute(
                `UPDATE marketplace_file_scan_jobs
                 SET status = 'queued',
                     scanner_id = NULL,
                     started_at = NULL,
                     lease_expires_at = NULL,
                     available_at = NOW(),
                     last_error_code = 'WORKER_LEASE_EXPIRED'
                 WHERE id = ?
                   AND status = 'processing'`,
                [job.id]
            );
        }
    }
}

// ========================================
// CLAIM JOB
// Khóa scanner trước để serialize claim
// từ cùng một Worker.
// ========================================
async function claimJob(scannerId) {
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [scannerRows] = await conn.execute(
            `SELECT id, max_concurrency
             FROM marketplace_scanners
             WHERE id = ?
               AND status != 'disabled'
             FOR UPDATE`,
            [scannerId]
        );

        if (!scannerRows.length) {
            throw new Error("SCANNER_NOT_AVAILABLE");
        }

        await recoverExpiredJobs(conn);

        const [activeRows] = await conn.execute(
            `SELECT COUNT(*) AS total
             FROM marketplace_file_scan_jobs
             WHERE scanner_id = ?
               AND status = 'processing'
               AND lease_expires_at > NOW()`,
            [scannerId]
        );

        if (
            Number(activeRows[0].total) >=
            Number(scannerRows[0].max_concurrency)
        ) {
            await conn.commit();
            return null;
        }

        const [jobs] = await conn.execute(
            `SELECT id, storage_key, scan_generation
             FROM marketplace_file_scan_jobs
             WHERE status = 'queued'
               AND available_at <= NOW()
               AND attempts < max_attempts
             ORDER BY id ASC
             LIMIT 1
             FOR UPDATE`
        );

        if (!jobs.length) {
            await conn.commit();
            return null;
        }

        const job = jobs[0];

        const [claimed] = await conn.execute(
            `UPDATE marketplace_file_scan_jobs
             SET status = 'processing',
                 scanner_id = ?,
                 attempts = attempts + 1,
                 started_at = NOW(),
                 lease_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
                 last_error_code = NULL
             WHERE id = ?
               AND status = 'queued'`,
            [scannerId, LEASE_MINUTES, job.id]
        );

        if (claimed.affectedRows !== 1) {
            throw new Error("SCAN_JOB_NOT_AVAILABLE");
        }

        await conn.execute(
            `UPDATE marketplace_file_scans
             SET scan_status = 'pending',
                 scan_attempts = scan_attempts + 1,
                 scan_started_at = NOW(),
                 last_error_code = NULL
             WHERE storage_key = ?`,
            [job.storage_key]
        );

        await conn.execute(
            `UPDATE marketplace_scanners
             SET last_job_at = NOW()
             WHERE id = ?`,
            [scannerId]
        );

        await conn.commit();

        return {
            jobId: Number(job.id),
            scanGeneration: Number(job.scan_generation),
            leaseMinutes: LEASE_MINUTES,
            fileEndpoint:
                `/api/marketplace/scanner/jobs/${job.id}/file`,
            renewEndpoint:
                `/api/marketplace/scanner/jobs/${job.id}/renew`
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// ========================================
// RENEW JOB LEASE
// Worker nên gia hạn định kỳ khi đang quét.
// ========================================
async function renewJob(scannerId, jobId) {
    const [result] = await db.execute(
        `UPDATE marketplace_file_scan_jobs
         SET lease_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE id = ?
           AND scanner_id = ?
           AND status = 'processing'
           AND lease_expires_at > NOW()`,
        [LEASE_MINUTES, jobId, scannerId]
    );

    if (result.affectedRows !== 1) {
        throw new Error("SCAN_JOB_NOT_AVAILABLE");
    }

    return {
        success: true,
        leaseMinutes: LEASE_MINUTES
    };
}

// ========================================
// GET JOB FILE
// ========================================
async function getJobFile(scannerId, jobId) {
    const [rows] = await db.execute(
        `SELECT storage_key
         FROM marketplace_file_scan_jobs
         WHERE id = ?
           AND scanner_id = ?
           AND status = 'processing'
           AND lease_expires_at > NOW()
         LIMIT 1`,
        [jobId, scannerId]
    );

    if (!rows.length) {
        throw new Error("SCAN_JOB_NOT_AVAILABLE");
    }

    return storageService.getObjectStream(rows[0].storage_key);
}

// ========================================
// GET EXPECTED SHA-256
// Đối chiếu hash Worker gửi với hash đã lưu.
// ========================================

// ========================================
// GET EXPECTED SHA-256
// Đối chiếu tất cả hash của cùng storage_key.
// Từ chối nếu thiếu, sai định dạng hoặc mâu thuẫn.
// ========================================
async function getExpectedFileHash(conn, storageKey) {
    const [rows] = await conn.execute(
        `SELECT file_hash
         FROM marketplace_product_files
         WHERE storage_key = ?
           AND file_hash IS NOT NULL
           AND file_hash <> ''

         UNION ALL

         SELECT file_hash
         FROM marketplace_delivery_version_files
         WHERE storage_key = ?
           AND file_hash IS NOT NULL
           AND file_hash <> ''`,
        [storageKey, storageKey]
    );

    if (!rows.length) {
        throw new Error("SCAN_FILE_HASH_MISSING");
    }

    const hashes = rows.map(row => {
        if (!validHash(row.file_hash)) {
            throw new Error("SCAN_FILE_HASH_MISSING");
        }

        return row.file_hash.toLowerCase();
    });

    const expectedHash = hashes[0];

    if (hashes.some(hash => hash !== expectedHash)) {
        throw new Error("SCAN_FILE_HASH_CONFLICT");
    }

    return expectedHash;
}

// ========================================
// COMPLETE JOB
// Chỉ nhận kết quả nếu hash trùng file gốc.
// ========================================
async function completeJob(scannerId, jobId, data = {}) {
    const result = data.result;

    if (!["clean", "infected"].includes(result)) {
        throw new Error("INVALID_SCAN_RESULT");
    }

    if (!validHash(data.fileHash)) {
        throw new Error("INVALID_SCAN_FILE_HASH");
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [jobs] = await conn.execute(
            `SELECT id, storage_key, scan_generation
             FROM marketplace_file_scan_jobs
             WHERE id = ?
               AND scanner_id = ?
               AND status = 'processing'
               AND lease_expires_at > NOW()
             FOR UPDATE`,
            [jobId, scannerId]
        );

        if (!jobs.length) {
            throw new Error("SCAN_JOB_NOT_AVAILABLE");
        }

        const job = jobs[0];

        const [newerJobs] = await conn.execute(
            `SELECT id
             FROM marketplace_file_scan_jobs
             WHERE storage_key = ?
               AND scan_generation > ?
             LIMIT 1`,
            [job.storage_key, job.scan_generation]
        );

        if (newerJobs.length) {
            await conn.execute(
                `UPDATE marketplace_file_scan_jobs
                 SET status = 'cancelled',
                     scanner_id = NULL,
                     lease_expires_at = NULL,
                     completed_at = NOW(),
                     last_error_code = 'SCAN_GENERATION_SUPERSEDED'
                 WHERE id = ?`,
                [jobId]
            );

            await conn.commit();

            return {
                success: false,
                stale: true,
                jobId: Number(jobId)
            };
        }

        const expectedHash = await getExpectedFileHash(
            conn,
            job.storage_key
        );

        if (data.fileHash.toLowerCase() !== expectedHash) {
            throw new Error("SCAN_FILE_HASH_MISMATCH");
        }

        await conn.execute(
            `UPDATE marketplace_file_scan_jobs
             SET status = 'completed',
                 scan_result = ?,
                 completed_at = NOW(),
                 lease_expires_at = NULL,
                 last_error_code = NULL
             WHERE id = ?`,
            [result, jobId]
        );

        const [scanUpdate] = await conn.execute(
            `UPDATE marketplace_file_scans
             SET scan_status = ?,
                 scan_engine = ?,
                 scan_signature_version = ?,
                 scanned_at = NOW(),
                 last_error_code = NULL,
                 scan_details = ?
             WHERE storage_key = ?`,
            [
                result,
                safeText(data.clamavVersion, 100) || "ClamAV",
                safeText(data.signatureVersion, 100),
                safeText(data.details, MAX_DETAILS_LENGTH),
                job.storage_key
            ]
        );

        if (scanUpdate.affectedRows !== 1) {
            throw new Error("SCAN_RECORD_NOT_FOUND");
        }

        await conn.commit();

        return {
            success: true,
            jobId: Number(jobId),
            result
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// ========================================
// FAIL JOB
// Retry tối đa theo max_attempts.
// ========================================
async function failJob(scannerId, jobId, errorCode) {
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [jobs] = await conn.execute(
            `SELECT id, storage_key, scan_generation,
                    attempts, max_attempts
             FROM marketplace_file_scan_jobs
             WHERE id = ?
               AND scanner_id = ?
               AND status = 'processing'
               AND lease_expires_at > NOW()
             FOR UPDATE`,
            [jobId, scannerId]
        );

        if (!jobs.length) {
            throw new Error("SCAN_JOB_NOT_AVAILABLE");
        }

        const job = jobs[0];
        const terminal =
            Number(job.attempts) >= Number(job.max_attempts);

        const safeCode =
            safeText(errorCode, MAX_ERROR_LENGTH) || "SCAN_FAILED";

        await conn.execute(
            `UPDATE marketplace_file_scan_jobs
             SET status = ?,
                 scanner_id = NULL,
                 available_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
                 started_at = NULL,
                 lease_expires_at = NULL,
                 completed_at = IF(? = 1, NOW(), NULL),
                 last_error_code = ?
             WHERE id = ?`,
            [
                terminal ? "failed" : "queued",
                RETRY_DELAY_MINUTES,
                terminal ? 1 : 0,
                safeCode,
                jobId
            ]
        );

        // Không để generation cũ ghi đè trạng thái generation mới.
        await conn.execute(
            `UPDATE marketplace_file_scans s
             SET s.scan_status = ?,
                 s.last_error_code = ?
             WHERE s.storage_key = ?
               AND NOT EXISTS (
                   SELECT 1
                   FROM marketplace_file_scan_jobs newer
                   WHERE newer.storage_key = s.storage_key
                     AND newer.scan_generation > ?
               )`,
            [
                terminal ? "error" : "pending",
                safeCode,
                job.storage_key,
                job.scan_generation
            ]
        );

        await conn.commit();

        return {
            success: true,
            retryScheduled: !terminal,
            terminal
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// ========================================
// ENQUEUE SCAN
// Phải gọi trong transaction upload.
// Generation đã tồn tại sẽ không bị reset.
// Generation mới sẽ vô hiệu hóa job cũ.
// ========================================
async function enqueueScan(conn, storageKey, generation = 1) {
    if (
        typeof storageKey !== "string" ||
        !storageKey.trim() ||
        !Number.isInteger(Number(generation)) ||
        Number(generation) < 1
    ) {
        throw new Error("INVALID_SCAN_CONFIG");
    }

    const key = storageKey.trim();
    const gen = Number(generation);

    await conn.execute(
        `INSERT IGNORE INTO marketplace_file_scans
            (storage_key, scan_status, scan_attempts)
         VALUES (?, 'pending', 0)`,
        [key]
    );

    const [insertResult] = await conn.execute(
        `INSERT IGNORE INTO marketplace_file_scan_jobs
            (storage_key, scan_generation, status)
         VALUES (?, ?, 'queued')`,
        [key, gen]
    );

    // Nếu generation này đã tồn tại, giữ nguyên trạng thái hiện tại.
    if (insertResult.affectedRows !== 1) {
        return {
            created: false,
            storageKey: key,
            generation: gen
        };
    }

    // Hủy các job cũ chưa hoàn tất.
    await conn.execute(
        `UPDATE marketplace_file_scan_jobs
         SET status = 'cancelled',
             scanner_id = NULL,
             lease_expires_at = NULL,
             completed_at = NOW(),
             last_error_code = 'SCAN_GENERATION_SUPERSEDED'
         WHERE storage_key = ?
           AND scan_generation < ?
           AND status IN ('queued', 'processing')`,
        [key, gen]
    );

    // Generation mới bắt buộc quét lại.
    await conn.execute(
        `UPDATE marketplace_file_scans
         SET scan_status = 'pending',
             scan_engine = NULL,
             scan_signature_version = NULL,
             scan_started_at = NULL,
             scanned_at = NULL,
             last_error_code = NULL,
             scan_details = NULL
         WHERE storage_key = ?`,
        [key]
    );

    return {
        created: true,
        storageKey: key,
        generation: gen
    };
}

module.exports = {
    registerScanner,
    authenticateScanner,
    heartbeat,
    claimJob,
    renewJob,
    getJobFile,
    completeJob,
    failJob,
    enqueueScan
};
