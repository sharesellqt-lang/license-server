
"use strict";

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand
} = require("@aws-sdk/client-s3");

const { uploadDir } = require("../middleware/marketplace.product.upload");

const STORAGE_PROVIDER = String(process.env.STORAGE_PROVIDER || "local").toLowerCase();

let s3Client = null;

function getProvider() {
    if (!["local", "r2"].includes(STORAGE_PROVIDER)) {
        throw new Error("INVALID_MARKETPLACE_STORAGE_PROVIDER");
    }

    return STORAGE_PROVIDER;
}

function validateKey(key) {
    if (typeof key !== "string" || !key.trim()) {
        throw new Error("INVALID_STORAGE_KEY");
    }

    if (
        key.startsWith("/") ||
        key.includes("\\") ||
        key.includes("\0") ||
        key.split("/").some(part => part === ".." || part === ".")
    ) {
        throw new Error("INVALID_STORAGE_KEY");
    }

    return key;
}

function getLocalPath(key) {
    validateKey(key);

    const root = path.resolve(uploadDir);
    const target = path.resolve(root, ...key.split("/"));
    const relative = path.relative(root, target);

    if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    ) {
        throw new Error("INVALID_STORAGE_PATH");
    }

    return target;
}

function getS3Config() {
    const endpoint = process.env.STORAGE_ENDPOINT;
    const bucket = process.env.STORAGE_BUCKET;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("R2_STORAGE_CONFIGURATION_INCOMPLETE");
    }

    return {
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        region: process.env.STORAGE_REGION || "auto"
    };
}

function getS3Client() {
    if (s3Client) return s3Client;

    const config = getS3Config();

    s3Client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: false,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });

    return s3Client;
}

async function uploadObject({
    key,
    body,
    contentType,
    contentLength,
    metadata
}) {
    validateKey(key);

    if (!body) throw new Error("STORAGE_UPLOAD_BODY_REQUIRED");

    if (getProvider() === "local") {
        const target = getLocalPath(key);

        await fs.promises.mkdir(path.dirname(target), {
            recursive: true
        });

        if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
            await fs.promises.writeFile(target, body);
        } else {
            await pipeline(body, fs.createWriteStream(target));
        }

        return {
            key,
            provider: "local"
        };
    }

    const config = getS3Config();

    await getS3Client().send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
        ...(contentLength != null ? { ContentLength: contentLength } : {}),
        ...(metadata ? { Metadata: metadata } : {})
    }));

    return {
        key,
        provider: "r2"
    };
}

async function getObjectStream(key) {
    validateKey(key);

    if (getProvider() === "local") {
        const target = getLocalPath(key);
        const stat = await fs.promises.stat(target);

        if (!stat.isFile()) {
            throw new Error("STORAGE_OBJECT_NOT_FOUND");
        }

        return {
            body: fs.createReadStream(target),
            contentLength: stat.size,
            contentType: "application/octet-stream",
            lastModified: stat.mtime
        };
    }

    const config = getS3Config();

    const result = await getS3Client().send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: key
    }));

    return {
        body: result.Body,
        contentLength: result.ContentLength,
        contentType: result.ContentType || "application/octet-stream",
        lastModified: result.LastModified,
        etag: result.ETag
    };
}

async function getObjectMetadata(key) {
    validateKey(key);

    if (getProvider() === "local") {
        const target = getLocalPath(key);
        const stat = await fs.promises.stat(target);

        return {
            key,
            contentLength: stat.size,
            lastModified: stat.mtime
        };
    }

    const config = getS3Config();

    const result = await getS3Client().send(new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key
    }));

    return {
        key,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        lastModified: result.LastModified,
        etag: result.ETag,
        metadata: result.Metadata
    };
}

async function copyObject(sourceKey, destinationKey) {
    validateKey(sourceKey);
    validateKey(destinationKey);

    if (getProvider() === "local") {
        const source = getLocalPath(sourceKey);
        const destination = getLocalPath(destinationKey);

        await fs.promises.mkdir(path.dirname(destination), {
            recursive: true
        });

        await fs.promises.copyFile(source, destination);

        return {
            key: destinationKey,
            provider: "local"
        };
    }

    const config = getS3Config();

    const encodedSource = sourceKey
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    await getS3Client().send(new CopyObjectCommand({
        Bucket: config.bucket,
        Key: destinationKey,
        CopySource: `${config.bucket}/${encodedSource}`,
        MetadataDirective: "COPY"
    }));

    return {
        key: destinationKey,
        provider: "r2"
    };
}

async function deleteObject(key) {
    validateKey(key);

    if (getProvider() === "local") {
        const target = getLocalPath(key);

        await fs.promises.rm(target, {
            force: true
        });

        return { key, deleted: true };
    }

    const config = getS3Config();

    await getS3Client().send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key
    }));

    return {
        key,
        deleted: true
    };
}

function getStorageInfo() {
    return {
        provider: getProvider(),
        configured: getProvider() === "local"
            ? true
            : Boolean(
                process.env.STORAGE_ENDPOINT &&
                process.env.STORAGE_BUCKET &&
                process.env.STORAGE_ACCESS_KEY_ID &&
                process.env.STORAGE_SECRET_ACCESS_KEY
            )
    };
}

module.exports = {
    getProvider,
    getStorageInfo,
    uploadObject,
    getObjectStream,
    getObjectMetadata,
    copyObject,
    deleteObject
};
