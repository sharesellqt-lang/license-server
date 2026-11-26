
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
        .replace(/đ/g, "d")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function normalizeCategoryPath(value) {
    return String(value || "")
        .trim()
        .replace(/[–—]/g, "-")
        .split(/\s*(?:>|\/)\s*/)
        .map(part => normalizeKey(part))
        .filter(Boolean)
        .join(">");
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

function decodeHtmlEntities(value) {
    return String(value)
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (match, code) => {
            const number = Number(code);

            return number > 0 && number <= 0x10FFFF
                ? String.fromCodePoint(number)
                : " ";
        })
        .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
            const number = parseInt(code, 16);

            return number > 0 && number <= 0x10FFFF
                ? String.fromCodePoint(number)
                : " ";
        });
}

function cleanDescription(value) {
    if (value === undefined || value === null) return null;

    let text = decodeHtmlEntities(value);

    text = text
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/#[\p{L}\p{N}_]+/gu, " ")
        .replace(/[✔️⭐️🌿💎👉🔰📩]/gu, " ")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();

    return text || null;
}

function createShortDescription(value, maxLength = 500, title = "") {
    const cleaned = cleanDescription(value);
    if (!cleaned) return null;

    const ignoredPatterns = [
        /chào mừng.*gian hàng/i,
        /nhấn theo dõi shop/i,
        /săn voucher/i,
        /inbox|comment.*shop/i,
        /nhắn tin.*shop/i,
        /quay video.*mở hàng/i,
        /quy định.*đổi trả/i,
        /chính sách.*đổi trả/i,
        /lưu ý sử dụng/i,
        /cam kết của shop/i,
        /shop hy vọng/i,
        /chúc quý khách/i,
        /cảm ơn quý khách/i,
        /khuyến khích.*giặt/i,
        /tránh phơi.*trực tiếp/i,
        /theo dõi shop/i,
        /liên hệ shop/i,
        /đánh giá.*sản phẩm/i,
        /100%.*(giống hình|không lỗi|không có lỗi)/i,
        /sản phẩm tốt nhất cho khách hàng/i,
        /chất lượng tốt nhất/i,
        /không phải hàng chợ/i
    ];

    const titleKey = String(title || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");

    const seen = new Set();

    const sentences = cleaned
        .split(/(?<=[.!?])\s+|[\n]+/)
        .map(sentence => sentence.trim())
        .filter(sentence => {
            if (sentence.length < 10) return false;

            if (ignoredPatterns.some(pattern => pattern.test(sentence))) {
                return false;
            }

            const key = sentence
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]/gu, "");

            if (!key || seen.has(key)) return false;
            seen.add(key);

            if (titleKey && key === titleKey) return false;

            return true;
        });

    if (!sentences.length) return null;

    const keywords = [
        "chất liệu", "lụa", "cotton", "vải", "da ",
        "màu sắc", "màu ", "thiết kế", "kiểu dáng",
        "form ", "kích thước", "size ", "trọng lượng",
        "thêu", "đính", "chống nước", "dung lượng",
        "công suất", "tính năng", "phù hợp",
        "sử dụng", "đường may"
    ];

    const scored = sentences.map((sentence, index) => {
        const lower = sentence.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
            if (lower.includes(keyword)) score += 2;
        }

        if (/\b\d+\s?(cm|mm|kg|g|ml|l|inch|w|v|mah)\b/i.test(sentence)) {
            score += 2;
        }

        if (/\b(size|s|m|l|xl|xxl)\b/i.test(sentence)) {
            score += 1;
        }

        return { sentence, index, score };
    });

    const useful = scored.filter(item => item.score > 0);
    const candidates = useful.length ? useful : scored.slice(0, 2);

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);

    const selected = [];
    let length = 0;

    for (const item of candidates) {
        const extraLength = item.sentence.length + (selected.length ? 1 : 0);

        if (length + extraLength > maxLength) continue;

        selected.push(item);
        length += extraLength;
    }

    selected.sort((a, b) => a.index - b.index);

    let result = selected.map(item => item.sentence).join(" ");

    if (!result) {
        result = sentences[0].slice(0, maxLength);
        const lastSpace = result.lastIndexOf(" ");

        if (lastSpace > 0) result = result.slice(0, lastSpace);
    }

    return result.trim();
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

    const rawCategory = pick(
        data,
        "category",
        "categoryName",
        "category_name",
        "productCategory",
        "product_category",
        "categorySlug",
        "category_slug",
        "danhMuc",
        "tenDanhMuc"
    );

    const category = cleanText(rawCategory, 500, "category");

    const rawDescription = pick(
        data,
        "shortDescription",
        "short_description",
        "description",
        "productDescription",
        "product_description"
    );

    const shortDescription = createShortDescription(
        rawDescription,
        500,
        title
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

    if (category !== null) result.category = category;
    if (rawCurrency) result.currency = currency;

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
// CATEGORY HELPERS
// =====================================================

function buildCategoryPath(categories, category) {
    const byId = new Map(categories.map(item => [item.id, item]));
    const parts = [];
    const visited = new Set();

    let current = category;

    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);

        current = current.parentId
            ? byId.get(current.parentId)
            : null;
    }

    return parts.join(" > ");
}

function mapImportCategories(rows) {
    const categories = rows.map(item => ({
        id: Number(item.id),
        name: String(item.name || "").trim(),
        slug: String(item.slug || "").trim(),
        parentId: item.parent_id == null
            ? null
            : Number(item.parent_id),
        status: String(item.status || "").toLowerCase()
    }));

    return categories.map(category => {
        const path = buildCategoryPath(categories, category);

        return {
            ...category,
            path,
            normalizedName: normalizeKey(category.name),
            normalizedSlug: normalizeKey(category.slug),
            normalizedPath: normalizeCategoryPath(path)
        };
    });
}

async function loadImportCategories() {
    const [rows] = await db.execute(
        `SELECT id, name, slug, parent_id, status
         FROM affiliate_categories
         ORDER BY id ASC`
    );

    return mapImportCategories(rows);
}

async function refreshImportCategories(conn) {
    const [rows] = await conn.execute(
        `SELECT id, name, slug, parent_id, status
         FROM affiliate_categories
         ORDER BY id ASC`
    );

    return mapImportCategories(rows);
}

function validateDefaultCategory(categoryId, categories) {
    if (
        categoryId === undefined ||
        categoryId === null ||
        categoryId === ""
    ) {
        return null;
    }

    const id = Number(categoryId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("INVALID_CATEGORY_ID");
    }

    const category = categories.find(item => item.id === id);

    if (!category) {
        throw new Error("AFFILIATE_CATEGORY_NOT_FOUND");
    }

    if (category.status !== "active") {
        throw new Error("AFFILIATE_CATEGORY_INACTIVE");
    }

    return category;
}

function createCategorySlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/đ/g, "d")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 180);
}

function findCategoryByParentAndName(categories, name, parentId) {
    const key = normalizeKey(name);

    return categories.filter(item =>
        item.parentId === parentId &&
        item.normalizedName === key
    );
}

function findCategoryBySlug(categories, slug) {
    const key = normalizeKey(slug);

    return categories.filter(item =>
        item.normalizedSlug === key
    );
}

function categorySegments(value) {
    return String(value || "")
        .trim()
        .split(/\s*(?:>|\/)\s*/)
        .map(item => item.trim())
        .filter(Boolean);
}

function categoryErrorCode(error) {
    return error?.code || error?.message || "";
}

function isCategoryDuplicateError(error) {
    return (
        error?.code === "ER_DUP_ENTRY" ||
        error?.code === "CATEGORY_SLUG_EXISTS"
    );
}

function makeUniqueCategorySlug(categories, name, parentId) {
    const base = createCategorySlug(name);

    if (!base) {
        throw new Error("INVALID_CATEGORY_NAME");
    }

    const used = new Set(
        categories.map(item => String(item.slug || "").toLowerCase())
    );

    if (!used.has(base)) return base;

    const parent = parentId
        ? categories.find(item => item.id === parentId)
        : null;

    const parentSlug = parent
        ? createCategorySlug(parent.slug || parent.name)
        : "category";

    const branchBase = `${base.slice(0, 180 - parentSlug.length - 1)}-${parentSlug}`;

    if (!used.has(branchBase)) return branchBase;

    for (let index = 2; index < 10000; index++) {
        const suffix = `-${index}`;
        const candidate = `${branchBase.slice(0, 180 - suffix.length)}${suffix}`;

        if (!used.has(candidate)) return candidate;
    }

    throw new Error("AFFILIATE_CATEGORY_SLUG_GENERATION_FAILED");
}

function assertActiveCategory(category) {
    if (category && category.status !== "active") {
        throw new Error("AFFILIATE_CATEGORY_INACTIVE");
    }
}

// =====================================================
// CATEGORY RESOLUTION - PREVIEW
// =====================================================

function resolveRowCategory(value, categories) {
    const raw = String(value || "").trim();

    if (!raw) return null;

    const key = normalizeKey(raw);
    const pathKey = normalizeCategoryPath(raw);

    if (!key) return null;

    const slugMatches = findCategoryBySlug(categories, raw);

    if (slugMatches.length === 1) {
        assertActiveCategory(slugMatches[0]);
        return slugMatches[0];
    }

    if (slugMatches.length > 1) {
        throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
    }

    const pathMatches = categories.filter(
        item => item.normalizedPath === pathKey
    );

    if (pathMatches.length === 1) {
        assertActiveCategory(pathMatches[0]);
        return pathMatches[0];
    }

    if (pathMatches.length > 1) {
        throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
    }

    const nameMatches = categories.filter(
        item => item.normalizedName === key
    );

    if (!nameMatches.length) {
        throw new Error("AFFILIATE_CATEGORY_NOT_FOUND");
    }

    if (nameMatches.length > 1) {
        throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
    }

    assertActiveCategory(nameMatches[0]);
    return nameMatches[0];
}

/*
 * Preview không ghi DB.
 *
 * Với đường dẫn Parent > Child:
 * - Nếu Parent đã tồn tại và inactive: báo lỗi.
 * - Nếu Parent tồn tại và active, Child chưa có: will_create.
 * - Nếu Parent chưa có: đánh dấu will_create cho cả nhánh.
 * - Nếu một cấp đã tồn tại nhưng inactive: không cho Preview giả định tạo mới.
 */
function previewImportCategory(value, categories) {
    const raw = String(value || "").trim();

    if (!raw) {
        return {
            categoryId: null,
            categoryName: null,
            categoryPath: null,
            categorySource: "none",
            categoryAction: "none"
        };
    }

    try {
        const existing = resolveRowCategory(raw, categories);

        return {
            categoryId: existing.id,
            categoryName: existing.name,
            categoryPath: existing.path,
            categorySource: "file",
            categoryAction: "existing"
        };
    } catch (error) {
        if (error.message !== "AFFILIATE_CATEGORY_NOT_FOUND") {
            throw error;
        }
    }

    const segments = categorySegments(raw);

    if (!segments.length) {
        throw new Error("INVALID_CATEGORY_NAME");
    }

    // Danh mục đơn: nếu cùng tên đã tồn tại duy nhất ở nhánh khác,
    // commit sẽ dùng lại danh mục đó thay vì tạo bản sao.
    if (segments.length === 1) {
        const key = normalizeKey(segments[0]);

        const sameName = categories.filter(
            item => item.normalizedName === key
        );

        if (sameName.length > 1) {
            throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
        }

        if (sameName.length === 1) {
            assertActiveCategory(sameName[0]);

            return {
                categoryId: sameName[0].id,
                categoryName: sameName[0].name,
                categoryPath: sameName[0].path,
                categorySource: "file",
                categoryAction: "existing"
            };
        }

        return {
            categoryId: null,
            categoryName: segments[0],
            categoryPath: segments[0],
            categorySource: "file",
            categoryAction: "will_create"
        };
    }

    // Đường dẫn nhiều cấp: kiểm tra các cấp đã tồn tại theo đúng parent.
    let parentId = null;
    let missingParent = false;

    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const matches = findCategoryByParentAndName(
            categories,
            segment,
            parentId
        );

        if (matches.length > 1) {
            throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
        }

        if (!matches.length) {
            missingParent = true;
            break;
        }

        assertActiveCategory(matches[0]);
        parentId = matches[0].id;
    }

    const leaf = segments[segments.length - 1];

    return {
        categoryId: null,
        categoryName: leaf,
        categoryPath: segments.join(" > "),
        categorySource: "file",
        categoryAction: "will_create"
    };
}

// =====================================================
// CATEGORY RESOLUTION - COMMIT
// =====================================================

async function createImportCategory(
    conn,
    name,
    parentId,
    actorUserId,
    audit = {},
    categories
) {
    if (!name || name.length > 150) {
        throw new Error("INVALID_CATEGORY_NAME");
    }

    /*
     * Tối đa 5 lần thử:
     * - Lần đầu dùng slug chưa tồn tại.
     * - Nếu import khác vừa tạo cùng danh mục, dùng lại.
     * - Nếu slug bị chiếm bởi danh mục khác, sinh slug mới.
     */
    for (let attempt = 0; attempt < 5; attempt++) {
        const refreshed = await refreshImportCategories(conn);

        const sameName = findCategoryByParentAndName(
            refreshed,
            name,
            parentId
        );

        if (sameName.length > 1) {
            throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
        }

        if (sameName.length === 1) {
            assertActiveCategory(sameName[0]);
            return {
                category: sameName[0],
                categories: refreshed
            };
        }

        const slug = makeUniqueCategorySlug(
            refreshed,
            name,
            parentId
        );

        try {
            const created = await productService.createCategory(
                {
                    name,
                    slug,
                    parent_id: parentId,
                    status: "active",
                    sort_order: 0
                },
                actorUserId,
                audit,
                { connection: conn }
            );

            const updatedCategories = await refreshImportCategories(conn);
            const createdCategory = updatedCategories.find(
                item => item.id === Number(created.id)
            );

            if (!createdCategory) {
                throw new Error("AFFILIATE_CATEGORY_CREATE_FAILED");
            }

            assertActiveCategory(createdCategory);

            return {
                category: createdCategory,
                categories: updatedCategories
            };
        } catch (error) {
            if (!isCategoryDuplicateError(error)) {
                throw error;
            }

            const latest = await refreshImportCategories(conn);

            const concurrentMatches = findCategoryByParentAndName(
                latest,
                name,
                parentId
            );

            if (concurrentMatches.length > 1) {
                throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
            }

            if (concurrentMatches.length === 1) {
                assertActiveCategory(concurrentMatches[0]);

                return {
                    category: concurrentMatches[0],
                    categories: latest
                };
            }

            // Slug bị chiếm bởi category khác: thử lại với slug mới.
            categories = latest;
        }
    }

    throw new Error("AFFILIATE_CATEGORY_CREATE_CONFLICT");
}

async function ensureImportCategory(
    conn,
    value,
    actorUserId,
    audit = {}
) {
    const segments = categorySegments(value);

    if (!segments.length) return null;

    let categories = await refreshImportCategories(conn);
    let parentId = null;
    let resolved = null;

    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const key = normalizeKey(segment);

        if (!key || segment.length > 150) {
            throw new Error("INVALID_CATEGORY_NAME");
        }

        let matches = findCategoryByParentAndName(
            categories,
            segment,
            parentId
        );

        // Với danh mục đơn, hỗ trợ nhập slug thay cho tên.
        if (segments.length === 1 && !matches.length) {
            const slugMatches = findCategoryBySlug(categories, segment);

            if (slugMatches.length > 1) {
                throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
            }

            if (slugMatches.length === 1) {
                matches = slugMatches;
            }
        }

        if (matches.length > 1) {
            throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
        }

        if (matches.length === 1) {
            resolved = matches[0];
            assertActiveCategory(resolved);
            parentId = resolved.id;
            continue;
        }

        /*
         * Với danh mục đơn, nếu tên tồn tại duy nhất ở nhánh khác
         * thì dùng lại danh mục đó, không tự tạo danh mục trùng tên.
         */
        if (segments.length === 1) {
            const sameName = categories.filter(
                item => item.normalizedName === key
            );

            if (sameName.length > 1) {
                throw new Error("AFFILIATE_CATEGORY_AMBIGUOUS");
            }

            if (sameName.length === 1) {
                assertActiveCategory(sameName[0]);
                resolved = sameName[0];
                break;
            }
        }

        const createdResult = await createImportCategory(
            conn,
            segment,
            parentId,
            actorUserId,
            audit,
            categories
        );

        resolved = createdResult.category;
        categories = createdResult.categories;
        parentId = resolved.id;
    }

    if (!resolved) {
        throw new Error("AFFILIATE_CATEGORY_NOT_FOUND");
    }

    return {
        id: resolved.id,
        name: resolved.name,
        path: resolved.path || buildCategoryPath(categories, resolved)
    };
}

// =====================================================
// IMPORT CATEGORY PRIORITY
// =====================================================

function resolveImportCategory(
    product,
    existing,
    defaultCategory,
    categories
) {
    // CSV category > default category > preserve existing > NULL.

    if (product.category) {
        const category = resolveRowCategory(
            product.category,
            categories
        );

        return {
            categoryId: category.id,
            categoryName: category.name,
            categoryPath: category.path,
            categorySource: "file"
        };
    }

    if (defaultCategory) {
        return {
            categoryId: defaultCategory.id,
            categoryName: defaultCategory.name,
            categoryPath: defaultCategory.path,
            categorySource: "default"
        };
    }

    if (existing && existing.category_id) {
        const category = categories.find(
            item => item.id === Number(existing.category_id)
        );

        return {
            categoryId: Number(existing.category_id),
            categoryName: category?.name || null,
            categoryPath: category?.path || null,
            categorySource: "preserved"
        };
    }

    return {
        categoryId: null,
        categoryName: null,
        categoryPath: null,
        categorySource: "none"
    };
}

// =====================================================
// EXISTING PRODUCT
// =====================================================

async function findExistingProduct(
    networkId,
    product,
    conn = db,
    forUpdate = false
) {
    const [rows] = await conn.execute(
        `SELECT id, product_id, sku_id, title, price,
                currency, image_url, affiliate_link, final_url,
                category_id
         FROM affiliate_products
         WHERE network_id = ?
           AND product_id = ?
           AND sku_id = ?
         LIMIT 1
         ${forUpdate ? "FOR UPDATE" : ""}`,
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

    const categories = await loadImportCategories();

    const defaultCategory = validateDefaultCategory(
        options.categoryId,
        categories
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

            let categoryInfo;

            if (product.category) {
                categoryInfo = previewImportCategory(
                    product.category,
                    categories
                );
            } else {
                categoryInfo = resolveImportCategory(
                    product,
                    existing,
                    defaultCategory,
                    categories
                );

                categoryInfo.categoryAction = categoryInfo.categoryId
                    ? "existing"
                    : "none";
            }

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
                shortDescription: product.shortDescription || "",
                existingId: existing ? existing.id : null,
                price: product.price ?? existing?.price ?? null,
                currency: product.currency || existing?.currency || "VND",

                categoryId: categoryInfo.categoryId,
                categoryName: categoryInfo.categoryName,
                categoryPath: categoryInfo.categoryPath,
                categorySource: categoryInfo.categorySource,
                categoryAction: categoryInfo.categoryAction,

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

    // Kiểm tra category mặc định trước khi tạo Sync Log.
    const categories = await loadImportCategories();

    const defaultCategory = validateDefaultCategory(
        options.categoryId,
        categories
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
            let conn = null;
            let transactionStarted = false;

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

                validateProductData(product, false);

                conn = await db.getConnection();
                await conn.beginTransaction();
                transactionStarted = true;

                /*
                 * Tra cứu sản phẩm sau khi đã mở transaction.
                 * FOR UPDATE giúp khóa bản ghi hiện tại trong lúc cập nhật.
                 */
                const existing = await findExistingProduct(
                    network.id,
                    product,
                    conn,
                    true
                );

                validateProductData(product, Boolean(existing));

                /*
                 * Đánh dấu identity sau khi kiểm tra trùng và trước xử lý.
                 * Nếu ghi DB thất bại, dòng tiếp theo cùng identity vẫn
                 * được xem là dòng trùng trong cùng file import.
                 */
                seen.add(identity);

                // Luôn tải danh mục mới trong transaction.
                const currentCategories = await refreshImportCategories(conn);

                const currentDefaultCategory =
                    options.categoryId !== undefined &&
                    options.categoryId !== null &&
                    options.categoryId !== ""
                        ? validateDefaultCategory(
                            options.categoryId,
                            currentCategories
                        )
                        : defaultCategory;

                let categoryInfo;

                if (product.category) {
                    const resolved = await ensureImportCategory(
                        conn,
                        product.category,
                        options.createdBy,
                        options.audit || {}
                    );

                    categoryInfo = {
                        categoryId: resolved.id,
                        categoryName: resolved.name,
                        categoryPath: resolved.path,
                        categorySource: "file"
                    };
                } else {
                    categoryInfo = resolveImportCategory(
                        product,
                        existing,
                        currentDefaultCategory,
                        currentCategories
                    );
                }

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

                    // CSV hoặc default mới được phép thay category.
                    // Nếu không có hai nguồn này thì giữ category hiện tại.
                    if (
                        categoryInfo.categorySource === "file" ||
                        categoryInfo.categorySource === "default"
                    ) {
                        updateData.categoryId = categoryInfo.categoryId;
                    }

                    if (Object.keys(updateData).length) {
                        await productService.updateProduct(
                            existing.id,
                            updateData,
                            options.createdBy,
                            options.audit || {},
                            { connection: conn }
                        );

                        await conn.commit();
                        transactionStarted = false;

                        result.summary.updated++;
                    } else {
                        await conn.rollback();
                        transactionStarted = false;

                        result.summary.skipped++;
                    }
                } else {
                    /*
                     * Kiểm tra product_id đã có SKU khác chưa.
                     * Truy vấn trong transaction để phân biệt newSku/newProduct.
                     */
                    const [productRows] = await conn.execute(
                        `SELECT id
                         FROM affiliate_products
                         WHERE network_id = ?
                           AND product_id = ?
                         LIMIT 1
                         FOR UPDATE`,
                        [
                            network.id,
                            product.productId
                        ]
                    );

                    await productService.createProduct(
                        {
                            ...product,
                            currency: product.currency || "VND",
                            networkId: network.id,
                            sourceType: "import",
                            status: options.defaultStatus || "draft",
                            categoryId: categoryInfo.categoryId
                        },
                        options.createdBy,
                        options.audit || {},
                        { connection: conn }
                    );

                    await conn.commit();
                    transactionStarted = false;

                    if (productRows.length) {
                        result.summary.newSkus++;
                    } else {
                        result.summary.newProducts++;
                    }
                }
            } catch (error) {
                if (conn && transactionStarted) {
                    try {
                        await conn.rollback();
                    } catch (rollbackError) {
                        error.rollbackError =
                            rollbackError.message || String(rollbackError);
                    }

                    transactionStarted = false;
                }

                result.summary.failed++;

                result.errors.push({
                    row: index + 1,
                    code:
                        error.message === "AFFILIATE_PRODUCT_ALREADY_EXISTS"
                            ? "AFFILIATE_IMPORT_DUPLICATE_PRODUCT"
                            : error.message || "AFFILIATE_IMPORT_ROW_FAILED"
                });
            } finally {
                if (conn) {
                    conn.release();
                }
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
