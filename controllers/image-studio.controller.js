
const db = require("../db");
const plans = require("../services/planConfig");
const { canAccessFeature } = require("../services/feature.service");
const imageAI = require("../services/image-studio/image-ai.service");

const AI_USAGE_ACTION = "image-studio-ai";

const enabled = () =>
    String(process.env.IMAGE_STUDIO_AI_ENABLED || "false").toLowerCase() === "true";

// =========================================
// GET AI CONFIG
// =========================================
exports.getConfig = (req, res) => {
    return res.json({
        aiEnabled: enabled()
    });
};

// =========================================
// GENERATE IMAGE-TO-IMAGE
// =========================================
exports.edit = async (req, res) => {
    try {
        // 1. CHECK AI SWITCH
        if (!enabled()) {
            return res.status(503).json({
                error: "AI Image Studio is currently disabled."
            });
        }

        // 2. CHECK UPLOADED IMAGE
        if (!req.file) {
            return res.status(400).json({
                error: "Missing or unsupported image file."
            });
        }

        // 3. VALIDATE PROMPT
        const prompt = String(req.body.prompt || "").trim();

        if (!prompt || prompt.length > 1000) {
            return res.status(400).json({
                error: "Prompt must contain 1–1000 characters."
            });
        }

        // 4. GET REALTIME USER
        const [rows] = await db.query(
            `SELECT id, email, plan, expire_at
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [req.user.id]
        );

        if (!rows.length) {
            return res.status(401).json({
                error: "User not found."
            });
        }

        const user = rows[0];
        const isAdmin = !!req.user.isAdmin;

        // 5. CHECK VIP ACCESS
        const allowed = isAdmin || await canAccessFeature(user, "vipMode");

        if (!allowed) {
            return res.status(403).json({
                error: "VIP access required."
            });
        }

        // 6. CHECK AI DAILY QUOTA
        const plan = String(req.user.plan || user.plan || "free")
            .trim()
            .toLowerCase();

        const limit = plans[AI_USAGE_ACTION]?.[plan];

        // Fail closed if quota configuration is missing.
        if (!isAdmin && limit === undefined) {
            console.error("[IMAGE STUDIO AI] Missing quota config:", plan);

            return res.status(500).json({
                error: "Image Studio AI quota is not configured."
            });
        }

        if (!isAdmin && limit !== -1) {
            const [usage] = await db.query(
                `SELECT COUNT(*) AS total
                 FROM usage_logs
                 WHERE user_id = ?
                   AND action = ?
                   AND DATE(created_at) = CURDATE()`,
                [req.user.id, AI_USAGE_ACTION]
            );

            const used = Number(usage[0]?.total || 0);

            if (used >= limit) {
                return res.status(429).json({
                    error: "Daily Image Studio AI limit reached.",
                    used,
                    limit
                });
            }
        }

        // 7. CALL AI PROVIDER
        const image = await imageAI.edit({
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            prompt
        });

        if (!image?.base64 || !image?.mimeType) {
            throw new Error("AI provider returned invalid image data.");
        }

        // 8. LOG AI USAGE
        await db.query(
            `INSERT INTO usage_logs (user_id, action)
             VALUES (?, ?)`,
            [req.user.id, AI_USAGE_ACTION]
        );

        // 9. RETURN IMAGE
        return res.json({
            success: true,
            image: `data:${image.mimeType};base64,${image.base64}`
        });

    } catch (err) {
        console.error("[IMAGE STUDIO AI]", err);

        return res.status(500).json({
            error: err.message || "Image editing failed."
        });
    }
};
