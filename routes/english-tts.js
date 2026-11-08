const path = require("path");
const express = require("express");
const textToSpeech = require("@google-cloud/text-to-speech");
const auth = require("../middleware/auth");
const db = require("../db");

const router = express.Router();
const client = new textToSpeech.TextToSpeechClient({
    keyFilename: process.env.GOOGLE_TTS_KEY_FILE
        ? path.resolve(process.env.GOOGLE_TTS_KEY_FILE)
        : undefined,
    projectId: "daai-487111"
});


router.use(auth);

const PLAN_LIMITS = {
    free: 50,
    pro: 5000,
    vip: 7000
};

const VOICE_PROFILES = {
    young_female: {
        label: "Nữ trẻ",
        gender: "FEMALE",
        pitch: 0,
        rate: 0.96
    },
    elderly_female: {
        label: "Nữ lớn tuổi",
        gender: "FEMALE",
        pitch: -3,
        rate: 0.86
    },
    elderly_male: {
        label: "Nam lớn tuổi",
        gender: "MALE",
        pitch: -3,
        rate: 0.86
    },
    young_male: {
        label: "Nam trẻ",
        gender: "MALE",
        pitch: 0,
        rate: 0.96
    },
    boy: {
        label: "Bé trai",
        gender: "MALE",
        pitch: 5,
        rate: 1.05
    },
    girl: {
        label: "Bé gái",
        gender: "FEMALE",
        pitch: 4,
        rate: 1.05
    }
};

let voiceCache = null;
let voiceCacheTime = 0;

function getVietnamMonthStart() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit"
    }).formatToParts(new Date());

    const year = parts.find(p => p.type === "year").value;
    const month = parts.find(p => p.type === "month").value;

    return `${year}-${month}-01`;
}

function getUserPlan(user) {
    const plan = String(user?.plan || "free").toLowerCase();

    return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)
        ? plan
        : "free";
}

async function getGoogleVoices() {
    const now = Date.now();

    if (voiceCache && now - voiceCacheTime < 60 * 60 * 1000) {
        return voiceCache;
    }

    const [result] = await client.listVoices({
        languageCode: "en-US"
    });

    voiceCache = Array.isArray(result.voices)
        ? result.voices
        : [];

    voiceCacheTime = now;

    return voiceCache;
}

function selectGoogleVoice(voices, gender, profileId) {
    const candidates = voices.filter(voice =>
        voice.ssmlGender === gender &&
        Array.isArray(voice.languageCodes) &&
        voice.languageCodes.includes("en-US")
    );

    if (!candidates.length) return null;

    const preferences = {
        young_female: ["Neural2-F", "Wavenet-F", "Studio-O"],
        elderly_female: ["Neural2-E", "Wavenet-E", "Standard-C"],
        girl: ["Neural2-G", "Wavenet-G", "Standard-E"],
        young_male: ["Neural2-D", "Wavenet-D", "Studio-Q"],
        elderly_male: ["Neural2-J", "Wavenet-D", "Standard-B"],
        boy: ["Neural2-I", "Wavenet-I", "Standard-A"]
    };

    const preferred = preferences[profileId] || [];

    for (const suffix of preferred) {
        const voice = candidates.find(item =>
            item.name.endsWith(suffix)
        );

        if (voice) return voice;
    }

    return candidates[0];
}

async function getUsage(userId, periodStart) {
    const [rows] = await db.query(
        `SELECT used_characters
         FROM english_tts_usage
         WHERE user_id = ? AND period_start = ?
         LIMIT 1`,
        [userId, periodStart]
    );

    return Number(rows[0]?.used_characters || 0);
}

async function reserveCharacters(userId, periodStart, characters, limit) {
    await db.query(
        `INSERT IGNORE INTO english_tts_usage
            (user_id, period_start, used_characters)
         VALUES (?, ?, 0)`,
        [userId, periodStart]
    );

    const [result] = await db.query(
        `UPDATE english_tts_usage
         SET used_characters = used_characters + ?
         WHERE user_id = ?
           AND period_start = ?
           AND used_characters + ? <= ?`,
        [characters, userId, periodStart, characters, limit]
    );

    return Number(result.affectedRows || 0) === 1;
}

async function refundCharacters(userId, periodStart, characters) {
    await db.query(
        `UPDATE english_tts_usage
         SET used_characters = GREATEST(0, used_characters - ?)
         WHERE user_id = ? AND period_start = ?`,
        [characters, userId, periodStart]
    );
}

/* GET /api/english-learning/tts/voices */
router.get("/voices", async (req, res) => {
    try {
        const voices = await getGoogleVoices();

        const profiles = Object.entries(VOICE_PROFILES).map(([id, profile]) => {
            const voice = selectGoogleVoice(voices, profile.gender, id);

            return {
                id,
                label: profile.label,
                available: !!voice,
                voiceName: voice?.name || null,
                languageCode: "en-US",
                pitch: profile.pitch,
                speakingRate: profile.rate
            };
        });

        res.json({
            success: true,
            profiles,
            note: "Các lựa chọn tuổi/độ tuổi là mô phỏng gần đúng bằng cao độ và tốc độ giọng đọc."
        });
    } catch (error) {
        console.error("[ENGLISH TTS VOICES]", error);

        res.status(503).json({
            success: false,
            message: "Không thể tải danh sách giọng đọc Google TTS."
        });
    }
});

/* GET /api/english-learning/tts/usage */
router.get("/usage", async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const limit = PLAN_LIMITS[plan];
        const periodStart = getVietnamMonthStart();

        if (req.user.isAdmin) {
            return res.json({
                success: true,
                plan,
                used: 0,
                limit: null,
                remaining: null,
                unlimited: true,
                periodStart
            });
        }

        const used = await getUsage(req.user.id, periodStart);

        res.json({
            success: true,
            plan,
            used,
            limit,
            remaining: Math.max(0, limit - used),
            unlimited: false,
            periodStart
        });
    } catch (error) {
        console.error("[ENGLISH TTS USAGE]", error);

        res.status(500).json({
            success: false,
            message: "Không thể tải thông tin hạn mức phát âm."
        });
    }
});

/* POST /api/english-learning/tts/synthesize */
router.post("/synthesize", async (req, res) => {
    let reserved = false;
    let periodStart = null;
    let characters = 0;
    let synthesisSucceeded = false;

    try {
        const text = String(req.body?.text || "").trim();
        const profileId = String(req.body?.profile || "young_female");

        if (!text) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập nội dung cần phát âm."
            });
        }

        if (Array.from(text).length > 5000) {
            return res.status(400).json({
                success: false,
                message: "Mỗi lần tổng hợp tối đa 5.000 ký tự."
            });
        }

        const profile = VOICE_PROFILES[profileId];

        if (!profile) {
            return res.status(400).json({
                success: false,
                message: "Kiểu giọng đọc không hợp lệ."
            });
        }

        const voices = await getGoogleVoices();
        const voice = selectGoogleVoice(voices, profile.gender, profileId);

        if (!voice) {
            return res.status(503).json({
                success: false,
                message: "Google hiện không có giọng đọc phù hợp."
            });
        }

        const plan = getUserPlan(req.user);
        const limit = PLAN_LIMITS[plan];

        characters = Array.from(text).length;
        periodStart = getVietnamMonthStart();

        if (!req.user.isAdmin) {
            reserved = await reserveCharacters(
                req.user.id,
                periodStart,
                characters,
                limit
            );

            if (!reserved) {
                const used = await getUsage(req.user.id, periodStart);

                return res.status(429).json({
                    success: false,
                    code: "TTS_QUOTA_EXCEEDED",
                    message: `Bạn đã sử dụng ${used}/${limit} ký tự trong tháng này.`,
                    usage: {
                        used,
                        limit,
                        remaining: Math.max(0, limit - used),
                        periodStart
                    }
                });
            }
        }

        const [response] = await client.synthesizeSpeech({
            input: { text },
            voice: {
                languageCode: "en-US",
                name: voice.name
            },
            audioConfig: {
                audioEncoding: "MP3",
                speakingRate: profile.rate,
                pitch: profile.pitch
            }
        });

        if (!response.audioContent) {
            throw new Error("Google TTS returned empty audio.");
        }

        synthesisSucceeded = true;
        const audio = Buffer.from(response.audioContent);

        res.set({
            "Content-Type": "audio/mpeg",
            "Content-Length": String(audio.length),
            "Cache-Control": "no-store",
            "Content-Disposition": 'attachment; filename="english-pronunciation.mp3"',
            "X-TTS-Characters": String(characters)
        });

        return res.status(200).send(audio);
    } catch (error) {
        if (reserved && !synthesisSucceeded && periodStart && characters > 0) {
            try {
                await refundCharacters(
                    req.user.id,
                    periodStart,
                    characters
                );
            } catch (refundError) {
                console.error("[ENGLISH TTS REFUND]", refundError);
            }
        }

        console.error("[ENGLISH TTS SYNTHESIZE]", error);

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Không thể tạo âm thanh. Vui lòng thử lại."
            });
        }
    }
});

module.exports = router;